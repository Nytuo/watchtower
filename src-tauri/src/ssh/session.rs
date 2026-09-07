use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::{ChannelId, ChannelMsg};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::{mpsc, Mutex};

use crate::error::{AppError, AppResult};
use crate::ssh::client::{
    HostKeyOutcome, HostKeyOutcomeSlot, RemoteForwardTable, SshEvent, SshHandler,
};
use crate::ssh::transport::{self, BoxedStream};
use crate::ssh::tunnel::TunnelManager;
use crate::vault::schema::{AdvancedOptions, AuthMethod, HostKeyPolicy, KnownHost, ServerEntry};

pub type SharedHandle = Arc<Mutex<Handle<SshHandler>>>;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const KBD_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize)]
pub struct KbdPromptItem {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct KbdPrompt {
    pub name: String,
    pub instructions: String,
    pub prompts: Vec<KbdPromptItem>,
}

pub struct KbdInteractive {
    pub channel: Channel<KbdPrompt>,
    pub rx: mpsc::Receiver<Vec<String>>,
}

pub struct SshSession {
    pub session_id: String,
    pub handle: SharedHandle,
    pub channel_id: ChannelId,

    pub shutdown_tx: mpsc::Sender<()>,
    pub resize_tx: mpsc::Sender<(u32, u32)>,

    pub sftp: Mutex<Option<Arc<SftpSession>>>,

    pub remote_forwards: RemoteForwardTable,
    pub tunnels: Mutex<TunnelManager>,

    pub host_key: HostKeyOutcome,

    pub jump_handles: Vec<Handle<SshHandler>>,

    pub log_file: Arc<Mutex<Option<tokio::fs::File>>>,
}

impl SshSession {
    pub async fn get_sftp(&self) -> AppResult<Arc<SftpSession>> {
        let mut sftp_lock = self.sftp.lock().await;
        if let Some(sftp) = sftp_lock.as_ref() {
            return Ok(sftp.clone());
        }

        let channel = {
            let handle = self.handle.lock().await;
            handle
                .channel_open_session()
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to open SFTP channel: {}", e)))?
        };

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to request sftp subsystem: {}", e)))?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to initialize SFTP session: {}", e)))?;

        let sftp = Arc::new(sftp);
        *sftp_lock = Some(sftp.clone());
        Ok(sftp)
    }
}

fn build_config(adv: &AdvancedOptions) -> client::Config {
    let mut c = client::Config::default();

    if let Some(secs) = adv.keepalive_interval {
        if secs > 0 {
            c.keepalive_interval = Some(Duration::from_secs(secs as u64));
        }
    }
    if let Some(max) = adv.keepalive_count_max {
        if max > 0 {
            c.keepalive_max = max as usize;
        }
    }
    if adv.compression {
        c.preferred = russh::Preferred {
            compression: Cow::Owned(vec![
                russh::compression::ZLIB,
                russh::compression::ZLIB_LEGACY,
                russh::compression::NONE,
            ]),
            ..russh::Preferred::DEFAULT
        };
    }

    c
}

fn make_handler(
    host: &str,
    port: u16,
    known_hosts: Vec<KnownHost>,
    policy: HostKeyPolicy,
) -> (SshHandler, RemoteForwardTable, HostKeyOutcomeSlot) {
    let (event_tx, _rx) = mpsc::unbounded_channel::<SshEvent>();
    let remote_forwards: RemoteForwardTable = Arc::new(Mutex::new(HashMap::new()));
    let outcome: HostKeyOutcomeSlot = Arc::new(Mutex::new(HostKeyOutcome::None));
    let handler = SshHandler {
        event_tx,
        remote_forwards: remote_forwards.clone(),
        host: host.to_string(),
        port,
        known_hosts,
        host_key_policy: policy,
        host_key_outcome: outcome.clone(),
    };
    (handler, remote_forwards, outcome)
}

async fn authenticate(
    handle: &mut Handle<SshHandler>,
    username: &str,
    auth: &AuthMethod,
    kbd: &mut Option<KbdInteractive>,
) -> AppResult<()> {
    match auth {
        AuthMethod::Password { password } => {
            let ok = handle
                .authenticate_password(username, password)
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if ok {
                return Ok(());
            }
            if let Some(k) = kbd.as_mut() {
                if keyboard_interactive_ui(handle, username, Some(password), k).await? {
                    return Ok(());
                }
            } else if keyboard_interactive_with_password(handle, username, password).await? {
                return Ok(());
            }
            Err(AppError::Ssh("Password authentication failed".into()))
        }
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            let key_pair = decode_key(private_key, passphrase.as_deref())?;
            expect_ok(
                handle
                    .authenticate_publickey(username, Arc::new(key_pair))
                    .await,
                "Key authentication failed",
            )
        }
        AuthMethod::KeyFile { path, passphrase } => {
            let data = std::fs::read_to_string(path)
                .map_err(|e| AppError::Ssh(format!("Cannot read key file: {}", e)))?;
            let key_pair = decode_key(&data, passphrase.as_deref())?;
            expect_ok(
                handle
                    .authenticate_publickey(username, Arc::new(key_pair))
                    .await,
                "Key authentication failed",
            )
        }
        AuthMethod::Agent => agent_authenticate(handle, username).await,
        AuthMethod::Keychain { .. } => Err(AppError::Ssh(
            "Keychain credential could not be resolved for this hop".into(),
        )),
        AuthMethod::None => {
            let ok = handle
                .authenticate_password(username, "")
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if ok {
                return Ok(());
            }
            if let Some(k) = kbd.as_mut() {
                if keyboard_interactive_ui(handle, username, None, k).await? {
                    return Ok(());
                }
            }
            Err(AppError::Ssh(
                "No authentication method provided and none-auth rejected".into(),
            ))
        }
    }
}

async fn keyboard_interactive_ui(
    handle: &mut Handle<SshHandler>,
    username: &str,
    password: Option<&str>,
    kbd: &mut KbdInteractive,
) -> AppResult<bool> {
    let mut resp = match handle
        .authenticate_keyboard_interactive_start(username, None)
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(false),
    };
    for _ in 0..12 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                // If every prompt is a hidden "password" field and we already
                // have the password, answer it without bothering the user.
                let all_password = !prompts.is_empty()
                    && prompts
                        .iter()
                        .all(|p| !p.echo && p.prompt.to_lowercase().contains("password"));
                let answers = if all_password && password.is_some() {
                    prompts
                        .iter()
                        .map(|_| password.unwrap().to_string())
                        .collect()
                } else {
                    let _ = kbd.channel.send(KbdPrompt {
                        name: name.clone(),
                        instructions: instructions.clone(),
                        prompts: prompts
                            .iter()
                            .map(|p| KbdPromptItem {
                                prompt: p.prompt.clone(),
                                echo: p.echo,
                            })
                            .collect(),
                    });
                    tokio::time::timeout(KBD_TIMEOUT, kbd.rx.recv())
                        .await
                        .map_err(|_| AppError::Ssh("Two-factor prompt timed out".into()))?
                        .ok_or_else(|| AppError::Ssh("Two-factor prompt cancelled".into()))?
                };
                resp = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| AppError::Ssh(format!("Keyboard-interactive failed: {}", e)))?;
            }
        }
    }
    Ok(false)
}

fn expect_ok(res: Result<bool, russh::Error>, msg: &str) -> AppResult<()> {
    match res {
        Ok(true) => Ok(()),
        Ok(false) => Err(AppError::Ssh(msg.into())),
        Err(e) => Err(AppError::Ssh(format!("Auth failed: {}", e))),
    }
}

fn decode_key(data: &str, passphrase: Option<&str>) -> AppResult<russh_keys::key::KeyPair> {
    russh_keys::decode_secret_key(data, passphrase)
        .map_err(|e| AppError::Ssh(format!("Key decode error: {}", e)))
}

async fn keyboard_interactive_with_password(
    handle: &mut Handle<SshHandler>,
    username: &str,
    password: &str,
) -> AppResult<bool> {
    let mut resp = match handle
        .authenticate_keyboard_interactive_start(username, None)
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(false),
    };
    for _ in 0..8 {
        match resp {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers = prompts.iter().map(|_| password.to_string()).collect();
                resp = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|e| AppError::Ssh(format!("Keyboard-interactive failed: {}", e)))?;
            }
        }
    }
    Ok(false)
}

async fn agent_authenticate(handle: &mut Handle<SshHandler>, username: &str) -> AppResult<()> {
    let mut agent = russh_keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|e| {
            AppError::Ssh(format!(
                "Cannot reach SSH agent (is SSH_AUTH_SOCK set?): {}",
                e
            ))
        })?;
    let identities = agent
        .request_identities()
        .await
        .map_err(|e| AppError::Ssh(format!("SSH agent error: {}", e)))?;
    if identities.is_empty() {
        return Err(AppError::Ssh("SSH agent has no identities loaded".into()));
    }

    let mut agent_opt = Some(agent);
    for key in identities {
        let a = agent_opt.take().unwrap();
        let (a_back, res) = handle.authenticate_future(username, key, a).await;
        agent_opt = Some(a_back);
        if matches!(res, Ok(true)) {
            return Ok(());
        }
    }
    Err(AppError::Ssh("SSH agent authentication rejected".into()))
}

fn host_key_error(outcome: HostKeyOutcome) -> Option<AppError> {
    match outcome {
        HostKeyOutcome::Mismatch {
            expected,
            got,
            key_type,
        } => Some(AppError::Ssh(format!(
            "HOSTKEY_MISMATCH {} {} {}\nHOST KEY MISMATCH — the {} key offered by the server (SHA256:{}) does not match the trusted key (SHA256:{}). This could be a man-in-the-middle attack.",
            key_type, got, expected, key_type, got, expected
        ))),
        HostKeyOutcome::UnknownRejected {
            fingerprint,
            key_type,
        } => Some(AppError::Ssh(format!(
            "HOSTKEY_UNKNOWN {} {}\nUnknown host key ({} SHA256:{}). Host-key checking is set to strict.",
            key_type, fingerprint, key_type, fingerprint
        ))),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
async fn connect_hop(
    stream: BoxedStream,
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
    adv: &AdvancedOptions,
    known_hosts: Vec<KnownHost>,
    policy: HostKeyPolicy,
    kbd: &mut Option<KbdInteractive>,
) -> AppResult<(Handle<SshHandler>, RemoteForwardTable, HostKeyOutcome)> {
    let config = Arc::new(build_config(adv));
    let (handler, remote_forwards, outcome) = make_handler(host, port, known_hosts, policy);

    let mut handle = match client::connect_stream(config, stream, handler).await {
        Ok(h) => h,
        Err(e) => {
            let o = outcome.lock().await.clone();
            return Err(host_key_error(o).unwrap_or_else(|| {
                AppError::Ssh(format!("Connection to {}:{} failed: {}", host, port, e))
            }));
        }
    };

    authenticate(&mut handle, username, auth, kbd).await?;
    let o = outcome.lock().await.clone();
    Ok((handle, remote_forwards, o))
}

/// Connects + authenticates against the target only (no jump chain, no PTY),
/// then disconnects. Returns the elapsed milliseconds.
pub async fn test_connect(
    server: &ServerEntry,
    known_hosts: Vec<KnownHost>,
    host_key_policy: HostKeyPolicy,
) -> AppResult<u64> {
    let started = std::time::Instant::now();
    let adv = &server.advanced;
    let stream = transport::open(
        &server.host,
        server.port,
        &adv.transport,
        adv.proxy.as_ref(),
        CONNECT_TIMEOUT,
    )
    .await?;
    let (handle, _rf, _hk) = connect_hop(
        stream,
        &server.host,
        server.port,
        &server.username,
        &server.auth,
        adv,
        known_hosts,
        host_key_policy,
        &mut None,
    )
    .await?;
    let ms = started.elapsed().as_millis() as u64;
    let _ = handle
        .disconnect(russh::Disconnect::ByApplication, "test complete", "en")
        .await;
    Ok(ms)
}

pub async fn connect_and_open_pty(
    server: &ServerEntry,
    session_id: String,
    cols: u32,
    rows: u32,
    channel: Channel<Vec<u8>>,
    known_hosts: Vec<KnownHost>,
    host_key_policy: HostKeyPolicy,
    default_shell: Option<String>,
    kbd: Option<KbdInteractive>,
) -> AppResult<SshSession> {
    let adv = &server.advanced;
    let mut kbd = kbd;

    // First TCP hop: the first jump host if present, otherwise the target.
    let (first_host, first_port) = match adv.jump_hosts.first() {
        Some(j) => (j.host.clone(), j.port),
        None => (server.host.clone(), server.port),
    };

    let mut stream: BoxedStream = transport::open(
        &first_host,
        first_port,
        &adv.transport,
        adv.proxy.as_ref(),
        CONNECT_TIMEOUT,
    )
    .await?;

    // Walk the jump-host chain, tunnelling to the next hop each time.
    let mut jump_handles: Vec<Handle<SshHandler>> = Vec::new();
    for (i, jh) in adv.jump_hosts.iter().enumerate() {
        let (next_host, next_port) = match adv.jump_hosts.get(i + 1) {
            Some(n) => (n.host.clone(), n.port),
            None => (server.host.clone(), server.port),
        };

        let (jh_handle, _rf, _o) = connect_hop(
            stream,
            &jh.host,
            jh.port,
            &jh.username,
            &jh.auth,
            adv,
            known_hosts.clone(),
            host_key_policy,
            &mut None,
        )
        .await?;

        let channel = jh_handle
            .channel_open_direct_tcpip(next_host.clone(), next_port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| {
                AppError::Ssh(format!(
                    "Jump host {} could not open a channel to {}:{}: {}",
                    jh.host, next_host, next_port, e
                ))
            })?;
        stream = Box::new(channel.into_stream());
        jump_handles.push(jh_handle);
    }

    // Final hop: the target server.
    let (handle, remote_forwards, host_key) = connect_hop(
        stream,
        &server.host,
        server.port,
        &server.username,
        &server.auth,
        adv,
        known_hosts,
        host_key_policy,
        &mut kbd,
    )
    .await?;

    let mut channel_handle = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(format!("Channel open failed: {}", e)))?;

    if adv.agent_forwarding {
        let _ = channel_handle.agent_forward(false).await;
    }
    if adv.x11_forwarding {
        let _ = channel_handle
            .request_x11(
                false,
                false,
                "MIT-MAGIC-COOKIE-1",
                "0000000000000000000000000000000000000000",
                0,
            )
            .await;
    }

    for env in &adv.env_vars {
        if !env.key.is_empty() {
            let _ = channel_handle
                .set_env(false, env.key.clone(), env.value.clone())
                .await;
        }
    }

    let channel_id = channel_handle.id();

    channel_handle
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| AppError::Ssh(format!("PTY request failed: {}", e)))?;

    match default_shell
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(shell) => {
            channel_handle
                .exec(false, format!("exec {}", shell))
                .await
                .map_err(|e| AppError::Ssh(format!("Shell exec failed: {}", e)))?;
        }
        None => {
            channel_handle
                .request_shell(false)
                .await
                .map_err(|e| AppError::Ssh(format!("Shell request failed: {}", e)))?;
        }
    }

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(8);

    let log_file: Arc<Mutex<Option<tokio::fs::File>>> = Arc::new(Mutex::new(None));
    let pump_log = log_file.clone();

    tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let mut buffer = Vec::new();
        let mut last_flush = tokio::time::Instant::now();
        let flush_interval = tokio::time::Duration::from_millis(16);
        let max_buffer = 4096;

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                Some((c, r)) = resize_rx.recv() => {
                    let _ = channel_handle.window_change(c, r, 0, 0).await;
                }
                msg = channel_handle.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            if let Some(f) = pump_log.lock().await.as_mut() {
                                let _ = f.write_all(&data).await;
                            }
                            buffer.extend_from_slice(&data);
                            let now = tokio::time::Instant::now();
                            if buffer.len() >= max_buffer || now.duration_since(last_flush) >= flush_interval {
                                let _ = channel.send(buffer.clone());
                                buffer.clear();
                                last_flush = now;
                            }
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            buffer.extend_from_slice(&data);
                            if buffer.len() >= max_buffer {
                                let _ = channel.send(buffer.clone());
                                buffer.clear();
                                last_flush = tokio::time::Instant::now();
                            }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            if !buffer.is_empty() {
                                let _ = channel.send(buffer.clone());
                            }
                            break;
                        }
                        _ => {}
                    }
                }
                _ = tokio::time::sleep(flush_interval) => {
                    if !buffer.is_empty() {
                        let _ = channel.send(buffer.clone());
                        buffer.clear();
                        last_flush = tokio::time::Instant::now();
                    }
                }
            }
        }
    });

    Ok(SshSession {
        session_id,
        handle: Arc::new(Mutex::new(handle)),
        channel_id,
        shutdown_tx,
        resize_tx,
        sftp: Mutex::new(None),
        remote_forwards,
        tunnels: Mutex::new(TunnelManager::new()),
        host_key,
        jump_handles,
        log_file,
    })
}

pub struct SessionManager {
    pub sessions: HashMap<String, SshSession>,
    pub term_sessions: HashMap<String, crate::commands::term::TermSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            term_sessions: HashMap::new(),
        }
    }
}

pub type SharedSessionManager = Mutex<SessionManager>;
