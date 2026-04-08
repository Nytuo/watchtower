use std::path::PathBuf;
use std::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::vault::crypto;
use crate::vault::schema::VaultData;

pub struct VaultState {
    pub data: Option<VaultData>,

    pub file_path: Option<PathBuf>,

    pub password: Option<String>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            data: None,
            file_path: None,
            password: None,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.data.is_some()
    }

    pub fn get_data(&self) -> AppResult<&VaultData> {
        self.data
            .as_ref()
            .ok_or_else(|| AppError::Vault("Vault is locked".into()))
    }

    pub fn get_data_mut(&mut self) -> AppResult<&mut VaultData> {
        self.data
            .as_mut()
            .ok_or_else(|| AppError::Vault("Vault is locked".into()))
    }
}

pub type SharedVaultState = Mutex<VaultState>;

pub fn create_vault(path: &PathBuf, password: &str) -> AppResult<VaultData> {
    let data = VaultData::default();
    save_vault(path, password, &data)?;
    Ok(data)
}

pub fn open_vault(path: &PathBuf, password: &str) -> AppResult<VaultData> {
    let raw = std::fs::read(path)
        .map_err(|e| AppError::Vault(format!("Cannot read vault file: {}", e)))?;

    let plaintext = crypto::decrypt(&raw, password)?;

    let data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Vault(format!("Corrupt vault data: {}", e)))?;

    Ok(data)
}

pub fn save_vault(path: &PathBuf, password: &str, data: &VaultData) -> AppResult<()> {
    let json = serde_json::to_vec(data)?;
    let encrypted = crypto::encrypt(&json, password)?;

    let tmp_path = path.with_extension("nyt.tmp");
    std::fs::write(&tmp_path, &encrypted)?;
    std::fs::rename(&tmp_path, path)?;

    Ok(())
}

pub fn default_vault_path() -> PathBuf {
    let mut path = dirs_default();
    path.push("watchtower");
    std::fs::create_dir_all(&path).ok();
    path.push("default.nyt");
    path
}

fn dirs_default() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\"))
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        PathBuf::from(home).join(".config")
    }
}
