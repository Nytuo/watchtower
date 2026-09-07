use keyring::{Entry, Error as KeyringError};

use crate::error::AppError;

const SERVICE: &str = "com.watchtower.vault";

fn entry(vault_path: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, vault_path)
        .map_err(|e| AppError::General(format!("System keychain unavailable: {}", e)))
}

#[tauri::command]
pub fn biometric_available(vault_path: String) -> bool {
    entry(&vault_path).is_ok()
}

#[tauri::command]
pub fn biometric_has(vault_path: String) -> Result<bool, AppError> {
    match entry(&vault_path)?.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(KeyringError::Ambiguous(_)) => Ok(true),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}

#[tauri::command]
pub fn biometric_store(vault_path: String, password: String) -> Result<(), AppError> {
    entry(&vault_path)?
        .set_password(&password)
        .map_err(|e| AppError::General(format!("Could not save to system keychain: {}", e)))
}

#[tauri::command]
pub fn biometric_retrieve(vault_path: String) -> Result<Option<String>, AppError> {
    match entry(&vault_path)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}

#[tauri::command]
pub fn biometric_clear(vault_path: String) -> Result<(), AppError> {
    match entry(&vault_path)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}
