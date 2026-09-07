use std::collections::HashMap;

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::session::{self, KbdInteractive, KbdPrompt, SharedSessionManager};
use crate::vault::schema::{
    timestamp_now, AuthMethod, ConnectionLog, CredentialType, KnownHost, LogLevel,
};
use crate::vault::store::{self, SharedVaultState};

pub type SharedKbd = Mutex<HashMap<String, mpsc::Sender<Vec<String>>>>;

#[tauri::command]
pub async fn ssh_submit_kbd(
    client_id: String,
    answers: Option<Vec<String>>,
    kbd_state: State<'_, SharedKbd>,
) -> Result<(), AppError> {
    match answers {
        Some(a) => {
            let tx = kbd_state.lock().await.get(&client_id).cloned();
            if let Some(tx) = tx {
                let _ = tx.send(a).await;
            }
        }
        None => {
            // Cancel: dropping the sender ends the auth wait.
            kbd_state.lock().await.remove(&client_id);
        }
    }
    Ok(())
}

fn persist_known_host(
    vault_state: &State<'_, SharedVaultState>,
    kh: KnownHost,
) -> Result<(), AppError> {
    let mut vault = vault_state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let kdf = vault.kdf.clone();
    let key = vault.key.clone();
    let data = vault.get_data_mut()?;
    data.known_hosts
        .retain(|k| !(k.host == kh.host && k.port == kh.port));
    data.known_hosts.push(kh);
    if let (Some(path), Some(kdf), Some(key)) = (file_path, kdf, key) {
        store::save_vault(&path, &kdf, &key, data)?;
    }
    Ok(())
}

fn emit_log(
    channel: &Channel<ConnectionLog>,
    level: LogLevel,
    message: &str,
    detail: Option<&str>,
) {
    let log = ConnectionLog {
        timestamp: timestamp_now(),
        level,
        message: message.into(),
        detail: detail.map(String::from),
    };
    let _ = channel.send(log);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ssh_connect(
    server_id: String,
    client_id: String,
    cols: u32,
    rows: u32,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    on_kbd: Channel<KbdPrompt>,
    vault_state: State<'_, SharedVaultState>,
    session_state: State<'_, SharedSessionManager>,
    kbd_state: State<'_, SharedKbd>,
) -> Result<String, AppError> {
    emit_log(
        &on_log,
        LogLevel::Info,
        "Looking up server configuration...",
        None,
    );

    let (server, known_hosts, host_key_policy, default_shell) = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;

        let known_hosts = data.known_hosts.clone();
        let host_key_policy =
            crate::vault::schema::HostKeyPolicy::parse(&data.settings.host_key_policy);
        let default_shell = data.settings.default_shell.clone();

        let mut entry = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .cloned()
            .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", server_id)))?;

        if let AuthMethod::Keychain { ref keychain_id } = entry.auth.clone() {
            if keychain_id.is_empty() {
                return Err(AppError::Vault(
                    "Server has no keychain entry selected — please edit the server and choose a keychain entry".into()
                ));
            }

            let kc = data
                .keychains
                .iter()
                .find(|k| &k.id == keychain_id)
                .ok_or_else(|| {
                    AppError::Vault(format!("Keychain entry '{}' not found", keychain_id))
                })?;

            entry.auth = match &kc.credential {
                CredentialType::Password { password, .. } => AuthMethod::Password {
                    password: password.clone(),
                },
                CredentialType::SshKey {
                    private_key,
                    passphrase,
                    ..
                } => AuthMethod::Key {
                    private_key: private_key.clone(),
                    passphrase: passphrase.clone(),
                },
                CredentialType::Certificate {
                    private_key: Some(pk),
                    passphrase,
                    ..
                } => AuthMethod::Key {
                    private_key: pk.clone(),
                    passphrase: passphrase.clone(),
                },
                other => {
                    return Err(AppError::Ssh(format!(
                        "Keychain credential type '{}' cannot be used for SSH auth",
                        match other {
                            CredentialType::Certificate { .. } => "certificate (no private key)",
                            CredentialType::Fido { .. } => "fido",
                            CredentialType::TouchId { .. } => "touch_id",
                            _ => "unknown",
                        }
                    )))
                }
            };
        }

        (entry, known_hosts, host_key_policy, default_shell)
    };

    emit_log(
        &on_log,
        LogLevel::Info,
        &format!(
            "Connecting to {}@{}:{}",
            server.username, server.host, server.port
        ),
        Some(&format!("Protocol: {:?}", server.protocol)),
    );

    let session_id = Uuid::new_v4().to_string();

    let auth_desc = match &server.auth {
        crate::vault::schema::AuthMethod::Password { .. } => "password",
        crate::vault::schema::AuthMethod::Key { .. } => "inline key",
        crate::vault::schema::AuthMethod::KeyFile { path, .. } => {
            emit_log(
                &on_log,
                LogLevel::Info,
                "Authenticating...",
                Some(&format!("Method: key file ({})", path)),
            );
            "key_file"
        }
        crate::vault::schema::AuthMethod::Keychain { .. } => "keychain",
        crate::vault::schema::AuthMethod::Agent => "agent",
        crate::vault::schema::AuthMethod::None => "none",
    };

    if auth_desc != "key_file" {
        emit_log(
            &on_log,
            LogLevel::Info,
            "Authenticating...",
            Some(&format!("Method: {}", auth_desc)),
        );
    }

    let (kbd_tx, kbd_rx) = mpsc::channel::<Vec<String>>(4);
    kbd_state.lock().await.insert(client_id.clone(), kbd_tx);
    let kbd = KbdInteractive {
        channel: on_kbd,
        rx: kbd_rx,
    };

    let result = session::connect_and_open_pty(
        &server,
        session_id.clone(),
        cols,
        rows,
        on_data,
        known_hosts,
        host_key_policy,
        default_shell,
        Some(kbd),
    )
    .await;
    kbd_state.lock().await.remove(&client_id);

    match result {
        Ok(ssh_session) => {
            match &ssh_session.host_key {
                crate::ssh::client::HostKeyOutcome::Verified {
                    fingerprint,
                    key_type,
                } => {
                    emit_log(
                        &on_log,
                        LogLevel::Success,
                        "Host key verified",
                        Some(&format!("{} SHA256:{}", key_type, fingerprint)),
                    );
                }
                crate::ssh::client::HostKeyOutcome::AcceptedNew {
                    fingerprint,
                    key_type,
                } => {
                    let kh = crate::vault::schema::KnownHost {
                        host: server.host.clone(),
                        port: server.port,
                        key_type: key_type.clone(),
                        key_fingerprint: fingerprint.clone(),
                        key_data: None,
                        first_seen: crate::vault::schema::timestamp_now(),
                        last_seen: None,
                        trusted: true,
                    };
                    if let Err(e) = persist_known_host(&vault_state, kh) {
                        emit_log(
                            &on_log,
                            LogLevel::Warning,
                            "Could not save host key to vault",
                            Some(&format!("{}", e)),
                        );
                    }
                    emit_log(
                        &on_log,
                        LogLevel::Warning,
                        "New host key trusted on first use",
                        Some(&format!("{} SHA256:{}", key_type, fingerprint)),
                    );
                }
                _ => {}
            }

            emit_log(
                &on_log,
                LogLevel::Success,
                "Connected successfully",
                Some(&format!("Session: {}", session_id)),
            );

            let mut manager = session_state.lock().await;
            manager.sessions.insert(session_id.clone(), ssh_session);

            if server.advanced.startup_command.is_some() {
                emit_log(
                    &on_log,
                    LogLevel::Info,
                    "Startup command configured",
                    Some("Will execute after shell is ready"),
                );
            }

            Ok(session_id)
        }
        Err(e) => {
            emit_log(
                &on_log,
                LogLevel::Error,
                "Connection failed",
                Some(&format!("{}", e)),
            );
            Err(e)
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ssh_connect_adhoc(
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
    cols: u32,
    rows: u32,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    vault_state: State<'_, SharedVaultState>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    let (known_hosts, host_key_policy, default_shell) = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;
        (
            data.known_hosts.clone(),
            crate::vault::schema::HostKeyPolicy::parse(&data.settings.host_key_policy),
            data.settings.default_shell.clone(),
        )
    };

    let auth = match auth_type.as_str() {
        "password" => AuthMethod::Password {
            password: password.unwrap_or_default(),
        },
        "key_file" => AuthMethod::KeyFile {
            path: key_path.ok_or_else(|| AppError::Ssh("Key file path required".into()))?,
            passphrase,
        },
        "agent" => AuthMethod::Agent,
        _ => AuthMethod::None,
    };

    let mut entry = crate::vault::schema::ServerEntry::new(
        format!("{}@{}", username, host),
        host.clone(),
        port,
        username.clone(),
        auth,
        crate::vault::schema::Protocol::Ssh,
    );
    entry.id = format!("adhoc:{}", Uuid::new_v4());

    let session_id = Uuid::new_v4().to_string();
    emit_log(
        &on_log,
        LogLevel::Info,
        &format!("Quick connect to {}@{}:{}", username, host, port),
        None,
    );

    match session::connect_and_open_pty(
        &entry,
        session_id.clone(),
        cols,
        rows,
        on_data,
        known_hosts,
        host_key_policy,
        default_shell,
        None,
    )
    .await
    {
        Ok(ssh_session) => {
            emit_log(&on_log, LogLevel::Success, "Connected", None);
            session_state
                .lock()
                .await
                .sessions
                .insert(session_id.clone(), ssh_session);
            Ok(session_id)
        }
        Err(e) => {
            emit_log(
                &on_log,
                LogLevel::Error,
                "Connection failed",
                Some(&format!("{}", e)),
            );
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn ssh_send_startup_command(
    session_id: String,
    server_id: String,
    vault_state: State<'_, SharedVaultState>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let startup_cmd = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;
        data.servers
            .iter()
            .find(|s| s.id == server_id)
            .and_then(|s| s.advanced.startup_command.clone())
    };

    if let Some(cmd) = startup_cmd {
        let manager = session_state.lock().await;
        if let Some(session) = manager.sessions.get(&session_id) {
            let data = format!("{}\n", cmd).into_bytes();
            let handle = session.handle.lock().await;
            handle
                .data(session.channel_id, data.into())
                .await
                .map_err(|e| AppError::Ssh(format!("Startup command failed: {:?}", e)))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data: Vec<u8>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let handle = session.handle.lock().await;
    handle
        .data(session.channel_id, data.into())
        .await
        .map_err(|e| AppError::Ssh(format!("Write failed: {:?}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let _ = session.resize_tx.send((cols, rows)).await;
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let mut manager = session_state.lock().await;

    if let Some(session) = manager.sessions.remove(&session_id) {
        let _ = session.shutdown_tx.send(()).await;

        session
            .tunnels
            .lock()
            .await
            .stop_all(&session.handle, &session.remote_forwards)
            .await;

        let handle = session.handle.lock().await;
        handle
            .disconnect(russh::Disconnect::ByApplication, "User disconnected", "en")
            .await
            .ok();
    }

    Ok(())
}

#[tauri::command]
pub async fn ssh_detect_os(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let mut exec_channel = {
        let handle = session.handle.lock().await;
        handle
            .channel_open_session()
            .await
            .map_err(|e| AppError::Ssh(format!("Exec channel open failed: {}", e)))?
    };

    let detect_cmd = r#"if [ -f /etc/os-release ]; then . /etc/os-release && echo "$ID"; elif command -v sw_vers >/dev/null 2>&1; then echo "macos"; elif uname -s 2>/dev/null | grep -qi 'freebsd'; then echo "freebsd"; elif uname -s 2>/dev/null | grep -qi 'CYGWIN\|MINGW\|MSYS'; then echo "windows"; else uname -s 2>/dev/null || echo "unknown"; fi"#;

    exec_channel
        .exec(true, detect_cmd)
        .await
        .map_err(|e| AppError::Ssh(format!("Exec failed: {}", e)))?;

    let mut output = Vec::new();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }

        tokio::select! {
            msg = exec_channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { data }) => {
                        output.extend_from_slice(&data);
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                        break;
                    }
                    _ => {}
                }
            }
            _ = tokio::time::sleep(remaining) => {
                break;
            }
        }
    }

    let result = String::from_utf8_lossy(&output)
        .trim()
        .to_lowercase()
        .to_string();

    Ok(if result.is_empty() {
        "unknown".to_string()
    } else {
        result
    })
}

#[tauri::command]
pub async fn ssh_list_sessions(
    session_state: State<'_, SharedSessionManager>,
) -> Result<Vec<String>, AppError> {
    let manager = session_state.lock().await;
    Ok(manager.sessions.keys().cloned().collect())
}

#[tauri::command]
pub async fn ssh_alive_sessions(
    session_state: State<'_, SharedSessionManager>,
) -> Result<Vec<String>, AppError> {
    let manager = session_state.lock().await;
    let mut alive = Vec::new();
    for (id, session) in manager.sessions.iter() {
        if !session.handle.lock().await.is_closed() {
            alive.push(id.clone());
        }
    }
    Ok(alive)
}

#[derive(serde::Serialize)]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn ssh_test_connection(
    server_id: String,
    vault_state: State<'_, SharedVaultState>,
) -> Result<TestResult, AppError> {
    let (server, known_hosts, policy) = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;
        let mut entry = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .cloned()
            .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", server_id)))?;
        if let AuthMethod::Keychain { ref keychain_id } = entry.auth.clone() {
            if let Some(kc) = data.keychains.iter().find(|k| &k.id == keychain_id) {
                entry.auth = match &kc.credential {
                    CredentialType::Password { password, .. } => AuthMethod::Password {
                        password: password.clone(),
                    },
                    CredentialType::SshKey {
                        private_key,
                        passphrase,
                        ..
                    } => AuthMethod::Key {
                        private_key: private_key.clone(),
                        passphrase: passphrase.clone(),
                    },
                    _ => entry.auth.clone(),
                };
            }
        }
        (
            entry,
            data.known_hosts.clone(),
            crate::vault::schema::HostKeyPolicy::parse(&data.settings.host_key_policy),
        )
    };

    match session::test_connect(&server, known_hosts, policy).await {
        Ok(ms) => Ok(TestResult {
            ok: true,
            latency_ms: ms,
            error: None,
        }),
        Err(e) => Ok(TestResult {
            ok: false,
            latency_ms: 0,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn ssh_start_log(
    session_id: String,
    path: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;
    let file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|e| AppError::General(format!("Cannot open log file: {}", e)))?;
    *session.log_file.lock().await = Some(file);
    Ok(())
}

#[tauri::command]
pub async fn ssh_stop_log(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    if let Some(session) = manager.sessions.get(&session_id) {
        *session.log_file.lock().await = None;
    }
    Ok(())
}
