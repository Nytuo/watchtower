//! Mobile stand-in for `mount.rs`: sshfs/WinFsp cannot run inside the iOS and
//! Android sandboxes. Keeps the command names so the JS API stays identical.

use std::collections::HashMap;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::sync::Mutex as AsyncMutex;

use crate::error::AppError;

pub type SharedMounts = AsyncMutex<HashMap<String, MountInfo>>;

#[derive(Clone, Serialize)]
pub struct MountInfo {
    pub id: String,
}

#[derive(Serialize)]
pub struct MountToolStatus {
    pub available: bool,
    pub tool: String,
    pub hint: String,
}

#[tauri::command]
pub async fn mount_check_tool() -> Result<MountToolStatus, AppError> {
    Ok(MountToolStatus {
        available: false,
        tool: String::new(),
        hint: "Mounting is not available on mobile.".into(),
    })
}

#[tauri::command]
pub async fn mount_sftp(
    _server_id: String,
    _remote_path: Option<String>,
    _mount_point: Option<String>,
) -> Result<MountInfo, AppError> {
    Err(AppError::General("Mounting is not available on mobile".into()))
}

#[tauri::command]
pub async fn unmount_sftp(_mount_id: String) -> Result<(), AppError> {
    Ok(())
}

#[tauri::command]
pub async fn list_mounts(_mounts: State<'_, SharedMounts>) -> Result<Vec<MountInfo>, AppError> {
    Ok(Vec::new())
}

pub async fn unmount_all(_mounts: &SharedMounts) {}

pub async fn reconcile_orphaned_mounts(_app: &AppHandle) {}
