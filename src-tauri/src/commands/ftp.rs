use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use suppaftp::list::File as FtpFile;
use suppaftp::{FtpStream, RustlsConnector, RustlsFtpStream};
use tauri::State;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::AppError;
use crate::vault::schema::{AuthMethod, CredentialType};
use crate::vault::store::SharedVaultState;

pub type SharedFtp = AsyncMutex<HashMap<String, Arc<std::sync::Mutex<Conn>>>>;

pub enum Conn {
    Plain(FtpStream),
    Tls(RustlsFtpStream),
}

macro_rules! op {
    ($c:expr, $s:ident, $body:expr) => {
        match $c {
            Conn::Plain($s) => $body,
            Conn::Tls($s) => $body,
        }
    };
}

fn tls_config() -> Arc<rustls::ClientConfig> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    Arc::new(
        rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

#[derive(Serialize)]
pub struct FtpEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: Option<u64>,
}

async fn with_conn<T, F>(ftp: &State<'_, SharedFtp>, id: &str, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&mut Conn) -> Result<T, AppError> + Send + 'static,
{
    let conn = ftp
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| AppError::General("FTP session not found".into()))?;
    tokio::task::spawn_blocking(move || {
        let mut guard = conn
            .lock()
            .map_err(|_| AppError::General("FTP lock".into()))?;
        f(&mut guard)
    })
    .await
    .map_err(|e| AppError::General(format!("FTP task failed: {}", e)))?
}

#[tauri::command]
pub async fn ftp_connect(
    host: String,
    port: u16,
    username: String,
    password: String,
    secure: bool,
    ftp: State<'_, SharedFtp>,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let conn = tokio::task::spawn_blocking(move || -> Result<Conn, AppError> {
        if secure {
            let mut s = RustlsFtpStream::connect((host.as_str(), port))
                .map_err(|e| AppError::General(format!("FTP connect failed: {}", e)))?;
            s = s
                .into_secure(RustlsConnector::from(tls_config()), &host)
                .map_err(|e| AppError::General(format!("FTPS handshake failed: {}", e)))?;
            s.login(&username, &password)
                .map_err(|e| AppError::General(format!("FTP login failed: {}", e)))?;
            s.transfer_type(suppaftp::types::FileType::Binary).ok();
            Ok(Conn::Tls(s))
        } else {
            let mut s = FtpStream::connect((host.as_str(), port))
                .map_err(|e| AppError::General(format!("FTP connect failed: {}", e)))?;
            s.login(&username, &password)
                .map_err(|e| AppError::General(format!("FTP login failed: {}", e)))?;
            s.transfer_type(suppaftp::types::FileType::Binary).ok();
            Ok(Conn::Plain(s))
        }
    })
    .await
    .map_err(|e| AppError::General(format!("FTP task failed: {}", e)))??;

    ftp.lock()
        .await
        .insert(id.clone(), Arc::new(std::sync::Mutex::new(conn)));
    Ok(id)
}

#[tauri::command]
pub async fn ftp_connect_server(
    server_id: String,
    secure: Option<bool>,
    vault_state: State<'_, SharedVaultState>,
    ftp: State<'_, SharedFtp>,
) -> Result<String, AppError> {
    let (host, port, username, password, secure) = {
        let vault = vault_state
            .lock()
            .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
        let data = vault.get_data()?;
        let entry = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .cloned()
            .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", server_id)))?;

        let mut auth = entry.auth.clone();
        if let AuthMethod::Keychain { keychain_id } = &auth {
            let kc = data
                .keychains
                .iter()
                .find(|k| &k.id == keychain_id)
                .ok_or_else(|| {
                    AppError::Vault(format!("Keychain entry '{}' not found", keychain_id))
                })?;
            if let CredentialType::Password { password, .. } = &kc.credential {
                auth = AuthMethod::Password {
                    password: password.clone(),
                };
            }
        }
        let password = match auth {
            AuthMethod::Password { password } => password,
            _ => {
                return Err(AppError::General(
                    "FTP requires password authentication".into(),
                ))
            }
        };
        let proto = format!("{:?}", entry.protocol).to_lowercase();
        let secure = secure.unwrap_or(proto.contains("ftps"));
        (
            entry.host.clone(),
            entry.port,
            entry.username.clone(),
            password,
            secure,
        )
    };

    ftp_connect(host, port, username, password, secure, ftp).await
}

#[tauri::command]
pub async fn ftp_disconnect(id: String, ftp: State<'_, SharedFtp>) -> Result<(), AppError> {
    if let Some(c) = ftp.lock().await.remove(&id) {
        tokio::task::spawn_blocking(move || {
            if let Ok(mut g) = c.lock() {
                op!(&mut *g, s, {
                    let _ = s.quit();
                });
            }
        })
        .await
        .ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn ftp_list(
    id: String,
    path: String,
    ftp: State<'_, SharedFtp>,
) -> Result<Vec<FtpEntry>, AppError> {
    let p = path.clone();
    with_conn(&ftp, &id, move |c| {
        let lines: Vec<String> = op!(c, s, {
            s.list(Some(&p))
                .map_err(|e| AppError::General(format!("FTP list failed: {}", e)))?
        });
        let base = p.trim_end_matches('/');
        let mut out = Vec::new();
        for line in lines {
            if let Ok(f) = FtpFile::try_from(line.as_str()) {
                if f.name() == "." || f.name() == ".." {
                    continue;
                }
                out.push(FtpEntry {
                    name: f.name().to_string(),
                    path: format!("{}/{}", base, f.name()),
                    size: f.size() as u64,
                    is_dir: f.is_directory(),
                    modified: f
                        .modified()
                        .duration_since(UNIX_EPOCH)
                        .ok()
                        .map(|d| d.as_secs()),
                });
            }
        }
        out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn ftp_mkdir(
    id: String,
    path: String,
    ftp: State<'_, SharedFtp>,
) -> Result<(), AppError> {
    with_conn(&ftp, &id, move |c| {
        op!(c, s, {
            s.mkdir(&path)
                .map_err(|e| AppError::General(format!("mkdir failed: {}", e)))
        })
    })
    .await
}

#[tauri::command]
pub async fn ftp_delete(
    id: String,
    path: String,
    is_dir: bool,
    ftp: State<'_, SharedFtp>,
) -> Result<(), AppError> {
    with_conn(&ftp, &id, move |c| {
        op!(c, s, {
            if is_dir { s.rmdir(&path) } else { s.rm(&path) }
                .map_err(|e| AppError::General(format!("delete failed: {}", e)))
        })
    })
    .await
}

#[tauri::command]
pub async fn ftp_rename(
    id: String,
    from: String,
    to: String,
    ftp: State<'_, SharedFtp>,
) -> Result<(), AppError> {
    with_conn(&ftp, &id, move |c| {
        op!(c, s, {
            s.rename(&from, &to)
                .map_err(|e| AppError::General(format!("rename failed: {}", e)))
        })
    })
    .await
}

#[tauri::command]
pub async fn ftp_download(
    id: String,
    remote: String,
    local: String,
    ftp: State<'_, SharedFtp>,
) -> Result<(), AppError> {
    with_conn(&ftp, &id, move |c| {
        let data = op!(c, s, {
            s.retr_as_buffer(&remote)
                .map_err(|e| AppError::General(format!("download failed: {}", e)))?
        });
        std::fs::write(&local, data.into_inner())
            .map_err(|e| AppError::General(format!("cannot write {}: {}", local, e)))
    })
    .await
}

#[tauri::command]
pub async fn ftp_upload(
    id: String,
    local: String,
    remote: String,
    ftp: State<'_, SharedFtp>,
) -> Result<(), AppError> {
    with_conn(&ftp, &id, move |c| {
        let bytes = std::fs::read(&local)
            .map_err(|e| AppError::General(format!("cannot read {}: {}", local, e)))?;
        let mut cursor = Cursor::new(bytes);
        op!(c, s, {
            s.put_file(&remote, &mut cursor)
                .map(|_| ())
                .map_err(|e| AppError::General(format!("upload failed: {}", e)))
        })
    })
    .await
}

#[allow(dead_code)]
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
