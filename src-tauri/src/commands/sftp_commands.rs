use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{ipc::Channel, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::AppError;
use crate::ssh::session::SharedSessionManager;
use russh_sftp::client::SftpSession;

#[derive(Debug, Serialize, Deserialize)]
pub struct SftpFileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub permissions: Option<u32>,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TransferProgress {
    pub bytes_sent: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub async fn sftp_ls(
    session_id: String,
    path: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<Vec<SftpFileEntry>, AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let entries = sftp
        .read_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to read directory: {}", e)))?;

    let mut result = Vec::new();
    for entry in entries {
        let name = entry.file_name();
        let metadata = entry.metadata();
        result.push(SftpFileEntry {
            name: name.clone(),
            path: Path::new(&path).join(&name).to_string_lossy().to_string(),
            size: metadata.size.unwrap_or(0),
            is_dir: metadata.is_dir(),
            permissions: metadata.permissions,
            modified: metadata.mtime.map(|m| m as u64),
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    sftp.create_dir(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to create directory: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to rename: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub async fn sftp_remove(
    session_id: String,
    path: String,
    is_dir: bool,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    if is_dir {
        sftp.remove_dir(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to remove directory: {}", e)))?;
    } else {
        sftp.remove_file(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to remove file: {}", e)))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;

    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to open local file: {}", e)))?;

    let total_bytes = local_file
        .metadata()
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to get local file metadata: {}", e)))?
        .len();

    let mut remote_file = sftp
        .create(&remote_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to create remote file: {}", e)))?;

    let mut buffer = [0u8; 16384];
    let mut bytes_sent = 0;

    loop {
        let n = local_file
            .read(&mut buffer)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to read local file: {}", e)))?;
        if n == 0 {
            break;
        }

        remote_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to write to remote file: {}", e)))?;

        bytes_sent += n as u64;
        let _ = on_progress.send(TransferProgress {
            bytes_sent,
            total_bytes,
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to open remote file: {}", e)))?;

    let total_bytes = sftp
        .metadata(&remote_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to get remote file metadata: {}", e)))?
        .size
        .unwrap_or(0);

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to create local file: {}", e)))?;

    let mut buffer = [0u8; 16384];
    let mut bytes_sent = 0;

    loop {
        let n = remote_file
            .read(&mut buffer)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to read remote file: {}", e)))?;
        if n == 0 {
            break;
        }

        local_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to write to local file: {}", e)))?;

        bytes_sent += n as u64;
        let _ = on_progress.send(TransferProgress {
            bytes_sent,
            total_bytes,
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_download_recursive(
    session_id: String,
    remote_path: String,
    local_dest_dir: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;

    let total_bytes = calculate_total_size(sftp.clone(), remote_path.clone()).await?;

    let mut progress = TransferProgress {
        bytes_sent: 0,
        total_bytes,
    };

    let remote_name = Path::new(&remote_path)
        .file_name()
        .ok_or_else(|| AppError::Ssh("Invalid remote path".into()))?;
    let local_path = PathBuf::from(local_dest_dir).join(remote_name);

    download_recursive(sftp, remote_path, local_path, on_progress, &mut progress).await?;

    Ok(())
}

fn calculate_total_size(
    sftp: Arc<SftpSession>,
    path: String,
) -> BoxFuture<'static, Result<u64, AppError>> {
    Box::pin(async move {
        let metadata = sftp
            .metadata(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to get metadata: {}", e)))?;

        if metadata.is_dir() {
            let mut total = 0;
            let entries = sftp
                .read_dir(&path)
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to read dir: {}", e)))?;
            for entry in entries {
                let entry_path = Path::new(&path)
                    .join(entry.file_name())
                    .to_string_lossy()
                    .to_string();
                total += calculate_total_size(sftp.clone(), entry_path).await?;
            }
            Ok(total)
        } else {
            Ok(metadata.size.unwrap_or(0))
        }
    })
}

fn download_recursive(
    sftp: Arc<SftpSession>,
    remote_path: String,
    local_path: PathBuf,
    on_progress: Channel<TransferProgress>,
    progress: &mut TransferProgress,
) -> BoxFuture<'_, Result<(), AppError>> {
    Box::pin(async move {
        let metadata = sftp
            .metadata(&remote_path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to get metadata: {}", e)))?;

        if metadata.is_dir() {
            tokio::fs::create_dir_all(&local_path)
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to create local dir: {}", e)))?;

            let entries = sftp
                .read_dir(&remote_path)
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to read dir: {}", e)))?;

            for entry in entries {
                let entry_name = entry.file_name();
                let next_remote = Path::new(&remote_path)
                    .join(&entry_name)
                    .to_string_lossy()
                    .to_string();
                let next_local = local_path.join(entry_name);
                download_recursive(
                    sftp.clone(),
                    next_remote,
                    next_local,
                    on_progress.clone(),
                    progress,
                )
                .await?;
            }
        } else {
            let mut remote_file = sftp
                .open(&remote_path)
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to open remote file: {}", e)))?;

            let mut local_file = tokio::fs::File::create(&local_path)
                .await
                .map_err(|e| AppError::Ssh(format!("Failed to create local file: {}", e)))?;

            let mut buffer = [0u8; 16384];
            loop {
                let n = remote_file
                    .read(&mut buffer)
                    .await
                    .map_err(|e| AppError::Ssh(format!("Failed to read remote file: {}", e)))?;
                if n == 0 {
                    break;
                }

                local_file
                    .write_all(&buffer[..n])
                    .await
                    .map_err(|e| AppError::Ssh(format!("Failed to write to local file: {}", e)))?;

                progress.bytes_sent += n as u64;
                let _ = on_progress.send(progress.clone());
            }
        }
        Ok(())
    })
}
