use std::collections::HashMap;
use std::sync::Arc;

use russh::client::{self, Handle};
use russh::{ChannelId, ChannelMsg};
use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;
use tokio::sync::{mpsc, Mutex};

use crate::error::{AppError, AppResult};
use crate::ssh::client::{SshEvent, SshHandler};
use crate::vault::schema::{AuthMethod, ServerEntry};

pub struct SshSession {
    pub session_id: String,
    pub handle: Handle<SshHandler>,
    pub channel_id: ChannelId,

    pub shutdown_tx: mpsc::Sender<()>,

    pub sftp: Mutex<Option<Arc<SftpSession>>>,
}

impl SshSession {
    pub async fn get_sftp(&self) -> AppResult<Arc<SftpSession>> {
        let mut sftp_lock = self.sftp.lock().await;
        if let Some(sftp) = sftp_lock.as_ref() {
            return Ok(sftp.clone());
        }

        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to open SFTP channel: {}", e)))?;

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

pub async fn connect_and_open_pty(
    server: &ServerEntry,
    session_id: String,
    cols: u32,
    rows: u32,
    channel: Channel<Vec<u8>>,
) -> AppResult<SshSession> {
    let config = Arc::new(client::Config {
        ..Default::default()
    });

    let (event_tx, _event_rx) = mpsc::unbounded_channel::<SshEvent>();

    let handler = SshHandler { event_tx };

    let addr = format!("{}:{}", server.host, server.port);

    let mut handle = client::connect(config, &addr, handler)
        .await
        .map_err(|e| AppError::Ssh(format!("Connection failed: {}", e)))?;

    match &server.auth {
        AuthMethod::Password { password } => {
            let auth_ok = handle
                .authenticate_password(&server.username, password)
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if !auth_ok {
                return Err(AppError::Ssh("Password authentication failed".into()));
            }
        }
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            let key_pair = if let Some(pass) = passphrase {
                russh_keys::decode_secret_key(private_key, Some(pass))
                    .map_err(|e| AppError::Ssh(format!("Key decode error: {}", e)))?
            } else {
                russh_keys::decode_secret_key(private_key, None)
                    .map_err(|e| AppError::Ssh(format!("Key decode error: {}", e)))?
            };
            let auth_ok = handle
                .authenticate_publickey(&server.username, Arc::new(key_pair))
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if !auth_ok {
                return Err(AppError::Ssh("Key authentication failed".into()));
            }
        }
        AuthMethod::KeyFile { path, passphrase } => {
            let key_data = std::fs::read_to_string(path)
                .map_err(|e| AppError::Ssh(format!("Cannot read key file: {}", e)))?;
            let key_pair = if let Some(pass) = passphrase {
                russh_keys::decode_secret_key(&key_data, Some(pass))
                    .map_err(|e| AppError::Ssh(format!("Key decode error: {}", e)))?
            } else {
                russh_keys::decode_secret_key(&key_data, None)
                    .map_err(|e| AppError::Ssh(format!("Key decode error: {}", e)))?
            };
            let auth_ok = handle
                .authenticate_publickey(&server.username, Arc::new(key_pair))
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if !auth_ok {
                return Err(AppError::Ssh("Key authentication failed".into()));
            }
        }
        AuthMethod::Keychain { keychain_id } => {
            return Err(AppError::Ssh(format!(
                "Keychain authentication not yet implemented (keychain_id: {})",
                keychain_id
            )));
        }
        AuthMethod::None => {
            let auth_ok = handle
                .authenticate_password(&server.username, "")
                .await
                .map_err(|e| AppError::Ssh(format!("Auth failed: {}", e)))?;
            if !auth_ok {
                return Err(AppError::Ssh(
                    "No authentication method provided and none-auth rejected".into(),
                ));
            }
        }
    }

    let mut channel_handle = handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(format!("Channel open failed: {}", e)))?;

    let channel_id = channel_handle.id();

    channel_handle
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| AppError::Ssh(format!("PTY request failed: {}", e)))?;

    channel_handle
        .request_shell(false)
        .await
        .map_err(|e| AppError::Ssh(format!("Shell request failed: {}", e)))?;

    let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut last_flush = tokio::time::Instant::now();
        let flush_interval = tokio::time::Duration::from_millis(16);
        let max_buffer = 4096;

        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                msg = channel_handle.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
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
        handle,
        channel_id,
        shutdown_tx,
        sftp: Mutex::new(None),
    })
}

pub struct SessionManager {
    pub sessions: HashMap<String, SshSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

pub type SharedSessionManager = Mutex<SessionManager>;
