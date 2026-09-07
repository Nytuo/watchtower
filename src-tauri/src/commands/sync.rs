use std::path::PathBuf;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::error::AppError;
use crate::vault::crypto::VAULT_MAGIC;
use crate::vault::store::SharedVaultState;

struct SyncCfg {
    url: String,
    user: Option<String>,
    pass: Option<String>,
}

fn hash_bytes(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    h.finalize().iter().map(|x| format!("{:02x}", x)).collect()
}

fn is_secure_url(url: &str) -> bool {
    if let Some(rest) = url.strip_prefix("https://") {
        return !rest.is_empty();
    }
    if let Some(rest) = url.strip_prefix("http://") {
        let host = rest.split(['/', ':']).next().unwrap_or("");
        return host == "localhost" || host == "127.0.0.1" || host == "[::1]";
    }
    false
}

fn load_cfg(state: &State<'_, SharedVaultState>) -> Result<(PathBuf, SyncCfg), AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    let s = &data.settings;
    if s.sync_mode == "off" {
        return Err(AppError::General("Sync is disabled".into()));
    }
    let url = s
        .sync_url
        .clone()
        .filter(|u| !u.is_empty())
        .ok_or_else(|| AppError::General("No sync URL configured".into()))?;
    if !is_secure_url(&url) {
        return Err(AppError::General(
            "Sync URL must use https:// (plain http is only allowed for localhost)".into(),
        ));
    }
    let path = vault
        .file_path
        .clone()
        .ok_or_else(|| AppError::General("No vault file is open".into()))?;
    Ok((
        path,
        SyncCfg {
            url,
            user: s.sync_username.clone(),
            pass: s.sync_password.clone(),
        },
    ))
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

async fn get_remote(c: &SyncCfg) -> Result<Option<Vec<u8>>, AppError> {
    let mut req = client().get(&c.url);
    if let Some(u) = &c.user {
        req = req.basic_auth(u, c.pass.as_ref());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::General(format!("Sync request failed: {}", e)))?;
    if resp.status().as_u16() == 404 {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(AppError::General(format!(
            "Sync server returned {}",
            resp.status()
        )));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::General(format!("Sync download failed: {}", e)))?;
    Ok(Some(bytes.to_vec()))
}

#[derive(Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub remote_exists: bool,
    pub in_sync: bool,
    pub local_hash: String,
    pub remote_hash: Option<String>,
}

#[tauri::command]
pub async fn sync_status(state: State<'_, SharedVaultState>) -> Result<SyncStatus, AppError> {
    let (path, c) = match load_cfg(&state) {
        Ok(x) => x,
        Err(_) => {
            return Ok(SyncStatus {
                configured: false,
                remote_exists: false,
                in_sync: false,
                local_hash: String::new(),
                remote_hash: None,
            })
        }
    };

    let local_hash = hash_bytes(&std::fs::read(&path).unwrap_or_default());

    match get_remote(&c).await? {
        None => Ok(SyncStatus {
            configured: true,
            remote_exists: false,
            in_sync: false,
            local_hash,
            remote_hash: None,
        }),
        Some(remote) => {
            let remote_hash = hash_bytes(&remote);
            Ok(SyncStatus {
                configured: true,
                remote_exists: true,
                in_sync: remote_hash == local_hash,
                local_hash,
                remote_hash: Some(remote_hash),
            })
        }
    }
}

#[tauri::command]
pub async fn sync_push(state: State<'_, SharedVaultState>) -> Result<(), AppError> {
    let (path, c) = load_cfg(&state)?;
    let bytes = std::fs::read(&path)
        .map_err(|e| AppError::General(format!("Cannot read vault file: {}", e)))?;

    let mut req = client()
        .put(&c.url)
        .header("Content-Type", "application/octet-stream")
        .body(bytes);
    if let Some(u) = &c.user {
        req = req.basic_auth(u, c.pass.as_ref());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::General(format!("Sync upload failed: {}", e)))?;
    if !resp.status().is_success() {
        return Err(AppError::General(format!(
            "Sync server rejected upload ({})",
            resp.status()
        )));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct SyncPullResult {
    /// A divergent remote blob was staged as `<vault>.incoming` and needs
    /// `vault_adopt_incoming(password)` to be applied.
    pub pending: bool,
}

/// Downloads the remote blob. If it differs, stages it next to the vault as
/// `<vault>.incoming` **without touching the live file**. The frontend then
/// calls `vault_adopt_incoming` with the master password, which only swaps
/// the file on a successful decrypt.
#[tauri::command]
pub async fn sync_pull(state: State<'_, SharedVaultState>) -> Result<SyncPullResult, AppError> {
    let (path, c) = load_cfg(&state)?;
    let local_hash = hash_bytes(&std::fs::read(&path).unwrap_or_default());

    let remote = get_remote(&c)
        .await?
        .ok_or_else(|| AppError::General("Remote vault does not exist yet — push first".into()))?;

    if hash_bytes(&remote) == local_hash {
        let _ = std::fs::remove_file(path.with_extension("nyt.incoming"));
        return Ok(SyncPullResult { pending: false });
    }
    if remote.len() < 5 || &remote[0..4] != VAULT_MAGIC {
        return Err(AppError::General(
            "Remote data is not a valid Watchtower vault".into(),
        ));
    }

    std::fs::write(path.with_extension("nyt.incoming"), &remote)
        .map_err(|e| AppError::General(format!("Cannot stage synced vault: {}", e)))?;
    Ok(SyncPullResult { pending: true })
}
