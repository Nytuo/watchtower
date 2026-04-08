use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

use crate::error::AppError;
use crate::ssh::session::{self, SharedSessionManager};
use crate::vault::schema::{timestamp_now, AuthMethod, ConnectionLog, CredentialType, LogLevel};
use crate::vault::store::SharedVaultState;

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
pub async fn ssh_connect(
    server_id: String,
    cols: u32,
    rows: u32,
    on_data: Channel<Vec<u8>>,
    on_log: Channel<ConnectionLog>,
    vault_state: State<'_, SharedVaultState>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<String, AppError> {
    emit_log(
        &on_log,
        LogLevel::Info,
        "Looking up server configuration...",
        None,
    );

    let server = {
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

        entry
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

    match session::connect_and_open_pty(&server, session_id.clone(), cols, rows, on_data).await {
        Ok(ssh_session) => {
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
            session
                .handle
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

    session
        .handle
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
    let mut manager = session_state.lock().await;
    let _session = manager
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let _ = (cols, rows);
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
            .handle
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

    let mut exec_channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| AppError::Ssh(format!("Exec channel open failed: {}", e)))?;

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
