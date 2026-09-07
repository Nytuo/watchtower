use tauri::State;

use crate::error::AppError;
use crate::ssh::session::SharedSessionManager;
use crate::ssh::tunnel::{self, TunnelSpec, TunnelStatus};

#[tauri::command]
pub async fn tunnel_start(
    session_id: String,
    spec: TunnelSpec,
    session_state: State<'_, SharedSessionManager>,
) -> Result<TunnelStatus, AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    tunnel::start(
        &session.tunnels,
        &session_id,
        session.handle.clone(),
        session.remote_forwards.clone(),
        spec,
    )
    .await
}

#[tauri::command]
pub async fn tunnel_stop(
    session_id: String,
    tunnel_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<(), AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;

    session
        .tunnels
        .lock()
        .await
        .stop(&tunnel_id, &session.handle, &session.remote_forwards)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn tunnel_list(
    session_id: String,
    session_state: State<'_, SharedSessionManager>,
) -> Result<Vec<TunnelStatus>, AppError> {
    let manager = session_state.lock().await;
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::Ssh(format!("Session '{}' not found", session_id)))?;
    let list = session.tunnels.lock().await.list();
    Ok(list)
}

#[tauri::command]
pub async fn tunnel_list_all(
    session_state: State<'_, SharedSessionManager>,
) -> Result<Vec<TunnelStatus>, AppError> {
    let manager = session_state.lock().await;
    let mut all = Vec::new();
    for session in manager.sessions.values() {
        all.extend(session.tunnels.lock().await.list());
    }
    Ok(all)
}
