use std::path::{Path, PathBuf};
use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};
use crate::vault::crypto::{self, Kdf};
use crate::vault::schema::VaultData;

pub struct VaultState {
    pub data: Option<VaultData>,
    pub file_path: Option<PathBuf>,
    pub kdf: Option<Kdf>,
    pub key: Option<Zeroizing<[u8; 32]>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            data: None,
            file_path: None,
            kdf: None,
            key: None,
        }
    }

    pub fn is_unlocked(&self) -> bool {
        self.data.is_some()
    }

    pub fn lock(&mut self) {
        self.data = None;
        self.kdf = None;
        self.key = None;
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

pub fn create_vault(
    path: &Path,
    password: &str,
) -> AppResult<(VaultData, Kdf, Zeroizing<[u8; 32]>)> {
    let kdf = Kdf::new_random();
    let key = crypto::derive_key(password, &kdf)?;
    let data = VaultData::default();
    save_vault(path, &kdf, &key, &data)?;
    Ok((data, kdf, key))
}

pub fn open_vault(path: &Path, password: &str) -> AppResult<(VaultData, Kdf, Zeroizing<[u8; 32]>)> {
    let raw = std::fs::read(path)
        .map_err(|e| AppError::Vault(format!("Cannot read vault file: {}", e)))?;

    let (plaintext, kdf, key) = crypto::decrypt(&raw, password)?;
    let plaintext = Zeroizing::new(plaintext);

    let data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|e| AppError::Vault(format!("Corrupt vault data: {}", e)))?;

    Ok((data, kdf, key))
}

pub fn save_vault(path: &Path, kdf: &Kdf, key: &[u8; 32], data: &VaultData) -> AppResult<()> {
    let json = Zeroizing::new(serde_json::to_vec(data)?);
    let encrypted = crypto::encrypt(&json, kdf, key)?;

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
