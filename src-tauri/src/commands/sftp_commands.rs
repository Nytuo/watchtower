use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::AppError;
use crate::ssh::session::SharedSessionManager;
use russh_sftp::client::SftpSession;

const CHUNK: usize = 262_144;

pub type SharedTransferFlags = Mutex<HashMap<String, Arc<AtomicBool>>>;

fn register(flags: &State<'_, SharedTransferFlags>, id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = flags.lock() {
        map.insert(id.to_string(), flag.clone());
    }
    flag
}

fn unregister(flags: &State<'_, SharedTransferFlags>, id: &str) {
    if let Ok(mut map) = flags.lock() {
        map.remove(id);
    }
}

fn is_cancelled(flag: &AtomicBool) -> bool {
    flag.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn sftp_cancel_transfer(
    transfer_id: String,
    flags: State<'_, SharedTransferFlags>,
) -> Result<(), AppError> {
    if let Ok(map) = flags.lock() {
        if let Some(f) = map.get(&transfer_id) {
            f.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

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
pub async fn sftp_chmod(
    session_id: String,
    path: String,
    mode: u32,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let mut meta = sftp
        .metadata(&path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to stat: {}", e)))?;
    meta.permissions = Some(mode & 0o7777);
    sftp.set_metadata(&path, meta)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to chmod: {}", e)))?;
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
        remove_dir_recursive(sftp, path).await?;
    } else {
        sftp.remove_file(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to remove file: {}", e)))?;
    }

    Ok(())
}

fn remove_dir_recursive(
    sftp: Arc<SftpSession>,
    path: String,
) -> BoxFuture<'static, Result<(), AppError>> {
    Box::pin(async move {
        let entries = sftp
            .read_dir(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to read dir: {}", e)))?;
        for entry in entries {
            let child = Path::new(&path)
                .join(entry.file_name())
                .to_string_lossy()
                .to_string();
            if entry.metadata().is_dir() {
                remove_dir_recursive(sftp.clone(), child).await?;
            } else {
                sftp.remove_file(&child)
                    .await
                    .map_err(|e| AppError::Ssh(format!("Failed to remove file: {}", e)))?;
            }
        }
        sftp.remove_dir(&path)
            .await
            .map_err(|e| AppError::Ssh(format!("Failed to remove directory: {}", e)))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn sftp_copy(
    session_id: String,
    src: String,
    dst: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let meta = sftp
        .metadata(&src)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to stat source: {}", e)))?;
    if meta.is_dir() {
        return Err(AppError::Ssh("Directory copy is not supported yet".into()));
    }

    let mut r = sftp
        .open(&src)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to open source: {}", e)))?;
    let mut w = sftp
        .create(&dst)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to create destination: {}", e)))?;

    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = r
            .read(&mut buf)
            .await
            .map_err(|e| AppError::Ssh(format!("Read failed: {}", e)))?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n])
            .await
            .map_err(|e| AppError::Ssh(format!("Write failed: {}", e)))?;
    }
    w.flush().await.ok();
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_path: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
    flags: State<'_, SharedTransferFlags>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let flag = register(&flags, &transfer_id);
    let result = upload_file(&sftp, &local_path, &remote_path, &on_progress, &flag).await;
    unregister(&flags, &transfer_id);
    result
}

async fn upload_file(
    sftp: &SftpSession,
    local_path: &str,
    remote_path: &str,
    on_progress: &Channel<TransferProgress>,
    flag: &AtomicBool,
) -> Result<(), AppError> {
    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to open local file: {}", e)))?;

    let total_bytes = local_file
        .metadata()
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to get local file metadata: {}", e)))?
        .len();

    let mut remote_file = sftp
        .create(remote_path)
        .await
        .map_err(|e| AppError::Ssh(format!("Failed to create remote file: {}", e)))?;

    let mut buffer = vec![0u8; CHUNK];
    let mut bytes_sent = 0u64;

    loop {
        if is_cancelled(flag) {
            return Err(AppError::Ssh("Transfer cancelled".into()));
        }
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
    remote_file.flush().await.ok();
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_recursive(
    session_id: String,
    transfer_id: String,
    local_path: String,
    remote_dest_dir: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
    flags: State<'_, SharedTransferFlags>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let flag = register(&flags, &transfer_id);

    let total_bytes = local_total_size(&PathBuf::from(&local_path)).await;
    let mut progress = TransferProgress {
        bytes_sent: 0,
        total_bytes,
    };

    let name = Path::new(&local_path)
        .file_name()
        .ok_or_else(|| AppError::Ssh("Invalid local path".into()))?
        .to_string_lossy()
        .to_string();
    let remote_root = format!("{}/{}", remote_dest_dir.trim_end_matches('/'), name);

    let sftp_arc = sftp.clone();
    let result = upload_recursive(
        &sftp_arc,
        PathBuf::from(&local_path),
        remote_root,
        &on_progress,
        &mut progress,
        &flag,
    )
    .await;
    unregister(&flags, &transfer_id);
    result
}

fn local_total_size(path: &Path) -> BoxFuture<'static, u64> {
    let path = path.to_path_buf();
    Box::pin(async move {
        let Ok(meta) = tokio::fs::metadata(&path).await else {
            return 0;
        };
        if meta.is_file() {
            return meta.len();
        }
        let mut total = 0;
        if let Ok(mut rd) = tokio::fs::read_dir(&path).await {
            while let Ok(Some(entry)) = rd.next_entry().await {
                total += local_total_size(&entry.path()).await;
            }
        }
        total
    })
}

fn upload_recursive<'a>(
    sftp: &'a SftpSession,
    local: PathBuf,
    remote: String,
    on_progress: &'a Channel<TransferProgress>,
    progress: &'a mut TransferProgress,
    flag: &'a AtomicBool,
) -> BoxFuture<'a, Result<(), AppError>> {
    Box::pin(async move {
        if is_cancelled(flag) {
            return Err(AppError::Ssh("Transfer cancelled".into()));
        }
        let meta = tokio::fs::metadata(&local)
            .await
            .map_err(|e| AppError::Ssh(format!("Local metadata failed: {}", e)))?;

        if meta.is_dir() {
            let _ = sftp.create_dir(&remote).await;
            let mut rd = tokio::fs::read_dir(&local)
                .await
                .map_err(|e| AppError::Ssh(format!("read_dir failed: {}", e)))?;
            while let Some(entry) = rd
                .next_entry()
                .await
                .map_err(|e| AppError::Ssh(format!("read_dir failed: {}", e)))?
            {
                let child_remote = format!("{}/{}", remote, entry.file_name().to_string_lossy());
                upload_recursive(
                    sftp,
                    entry.path(),
                    child_remote,
                    on_progress,
                    progress,
                    flag,
                )
                .await?;
            }
        } else {
            let mut lf = tokio::fs::File::open(&local)
                .await
                .map_err(|e| AppError::Ssh(format!("open failed: {}", e)))?;
            let mut rf = sftp
                .create(&remote)
                .await
                .map_err(|e| AppError::Ssh(format!("remote create failed: {}", e)))?;
            let mut buf = vec![0u8; CHUNK];
            loop {
                if is_cancelled(flag) {
                    return Err(AppError::Ssh("Transfer cancelled".into()));
                }
                let n = lf
                    .read(&mut buf)
                    .await
                    .map_err(|e| AppError::Ssh(format!("read failed: {}", e)))?;
                if n == 0 {
                    break;
                }
                rf.write_all(&buf[..n])
                    .await
                    .map_err(|e| AppError::Ssh(format!("write failed: {}", e)))?;
                progress.bytes_sent += n as u64;
                let _ = on_progress.send(progress.clone());
            }
            rf.flush().await.ok();
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    transfer_id: String,
    remote_path: String,
    local_path: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
    flags: State<'_, SharedTransferFlags>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let flag = register(&flags, &transfer_id);

    let result = async {
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

        let mut buffer = vec![0u8; CHUNK];
        let mut bytes_sent = 0u64;
        loop {
            if is_cancelled(&flag) {
                return Err(AppError::Ssh("Transfer cancelled".into()));
            }
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
        local_file.flush().await.ok();
        Ok(())
    }
    .await;

    unregister(&flags, &transfer_id);
    result
}

#[tauri::command]
pub async fn sftp_download_recursive(
    session_id: String,
    transfer_id: String,
    remote_path: String,
    local_dest_dir: String,
    on_progress: Channel<TransferProgress>,
    session_state: State<'_, SharedSessionManager>,
    flags: State<'_, SharedTransferFlags>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    let sftp = session.get_sftp().await?;
    let flag = register(&flags, &transfer_id);

    let result = async {
        let total_bytes = calculate_total_size(sftp.clone(), remote_path.clone()).await?;
        let mut progress = TransferProgress {
            bytes_sent: 0,
            total_bytes,
        };
        let remote_name = Path::new(&remote_path)
            .file_name()
            .ok_or_else(|| AppError::Ssh("Invalid remote path".into()))?;
        let local_path = PathBuf::from(local_dest_dir).join(remote_name);
        download_recursive(
            sftp,
            remote_path,
            local_path,
            on_progress,
            &mut progress,
            &flag,
        )
        .await
    }
    .await;

    unregister(&flags, &transfer_id);
    result
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

fn download_recursive<'a>(
    sftp: Arc<SftpSession>,
    remote_path: String,
    local_path: PathBuf,
    on_progress: Channel<TransferProgress>,
    progress: &'a mut TransferProgress,
    flag: &'a AtomicBool,
) -> BoxFuture<'a, Result<(), AppError>> {
    Box::pin(async move {
        if is_cancelled(flag) {
            return Err(AppError::Ssh("Transfer cancelled".into()));
        }
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
                    flag,
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

            let mut buffer = vec![0u8; CHUNK];
            loop {
                if is_cancelled(flag) {
                    return Err(AppError::Ssh("Transfer cancelled".into()));
                }
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
            local_file.flush().await.ok();
        }
        Ok(())
    })
}
