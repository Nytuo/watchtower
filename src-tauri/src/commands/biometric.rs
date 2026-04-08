use keyring::{Entry, Error as KeyringError};

use crate::error::AppError;

const SERVICE: &str = "com.watchtower.vault";

fn entry(vault_path: &str) -> Result<Entry, AppError> {
    Entry::new(SERVICE, vault_path)
        .map_err(|e| AppError::General(format!("System keychain unavailable: {}", e)))
}

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use tauri_plugin_wt_native::WtNativeExt;

    fn key(vault_path: &str) -> String {
        format!("vault:{vault_path}")
    }

    fn err(e: String) -> AppError {
        AppError::General(format!("System keystore error: {e}"))
    }

    pub fn has(app: &tauri::AppHandle, p: &str) -> Result<bool, AppError> {
        Ok(app.wt_native().secret_get(&key(p)).map_err(err)?.is_some())
    }
    pub fn store(app: &tauri::AppHandle, p: &str, pw: &str) -> Result<(), AppError> {
        app.wt_native().secret_set(&key(p), pw).map_err(err)
    }
    pub fn retrieve(app: &tauri::AppHandle, p: &str) -> Result<Option<String>, AppError> {
        app.wt_native().secret_get(&key(p)).map_err(err)
    }
    pub fn clear(app: &tauri::AppHandle, p: &str) -> Result<(), AppError> {
        app.wt_native().secret_delete(&key(p)).map_err(err)
    }
}

#[tauri::command]
pub fn biometric_available(vault_path: String) -> bool {
    #[cfg(target_os = "android")]
    {
        let _ = vault_path;
        return true;
    }
    #[cfg(not(target_os = "android"))]
    entry(&vault_path).is_ok()
}

#[tauri::command]
pub async fn biometric_has(app: tauri::AppHandle, vault_path: String) -> Result<bool, AppError> {
    #[cfg(target_os = "android")]
    return android::has(&app, &vault_path);
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    match entry(&vault_path)?.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(KeyringError::Ambiguous(_)) => Ok(true),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}

#[tauri::command]
pub async fn biometric_store(
    app: tauri::AppHandle,
    vault_path: String,
    password: String,
) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    return android::store(&app, &vault_path, &password);
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    entry(&vault_path)?
        .set_password(&password)
        .map_err(|e| AppError::General(format!("Could not save to system keychain: {}", e)))
}

#[tauri::command]
pub async fn biometric_retrieve(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<Option<String>, AppError> {
    #[cfg(target_os = "android")]
    return android::retrieve(&app, &vault_path);
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    match entry(&vault_path)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}

#[tauri::command]
pub async fn biometric_clear(app: tauri::AppHandle, vault_path: String) -> Result<(), AppError> {
    #[cfg(target_os = "android")]
    return android::clear(&app, &vault_path);
    #[cfg(not(target_os = "android"))]
    let _ = &app;
    match entry(&vault_path)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(AppError::General(format!("System keychain error: {}", e))),
    }
}

#[tauri::command]
pub async fn mobile_keepalive(
    app: tauri::AppHandle,
    active: bool,
    sessions: u32,
) -> Result<(), AppError> {
    #[cfg(mobile)]
    {
        use tauri_plugin_wt_native::WtNativeExt;
        return app
            .wt_native()
            .keepalive(active, sessions)
            .map_err(|e| AppError::General(format!("keep-alive: {e}")));
    }
    #[cfg(not(mobile))]
    {
        let _ = (app, active, sessions);
        Ok(())
    }
}
