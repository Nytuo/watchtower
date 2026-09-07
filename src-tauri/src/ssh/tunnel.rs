use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::ssh::client::{RemoteForward, RemoteForwardTable, SshHandler};

type Handle = russh::client::Handle<SshHandler>;
type SharedHandle = Arc<Mutex<Handle>>;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelStatus {
    pub id: String,
    pub session_id: String,
    pub name: String,
    pub kind: TunnelKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub active_connections: u64,
    pub total_connections: u64,
    pub error: Option<String>,
}

pub struct Tunnel {
    pub status: TunnelStatus,
    pub active: Arc<AtomicU64>,
    pub total: Arc<AtomicU64>,
    shutdown: mpsc::Sender<()>,
    kind: TunnelKind,
    bind_port_effective: u16,
}

impl Tunnel {
    pub fn snapshot(&self) -> TunnelStatus {
        let mut s = self.status.clone();
        s.active_connections = self.active.load(Ordering::Relaxed);
        s.total_connections = self.total.load(Ordering::Relaxed);
        s.bind_port = self.bind_port_effective;
        s
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TunnelSpec {
    pub name: String,
    pub kind: TunnelKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

pub struct TunnelManager {
    pub tunnels: HashMap<String, Tunnel>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: HashMap::new(),
        }
    }

    pub fn list(&self) -> Vec<TunnelStatus> {
        self.tunnels.values().map(|t| t.snapshot()).collect()
    }

    pub async fn stop(&mut self, id: &str, handle: &SharedHandle, table: &RemoteForwardTable) {
        if let Some(t) = self.tunnels.remove(id) {
            let _ = t.shutdown.try_send(());
            if t.kind == TunnelKind::Remote {
                table.lock().await.remove(&(t.bind_port_effective as u32));
                let h = handle.lock().await;
                let _ = h
                    .cancel_tcpip_forward(t.status.bind_host.clone(), t.bind_port_effective as u32)
                    .await;
            }
        }
    }

    pub async fn stop_all(&mut self, handle: &SharedHandle, table: &RemoteForwardTable) {
        let ids: Vec<String> = self.tunnels.keys().cloned().collect();
        for id in ids {
            self.stop(&id, handle, table).await;
        }
    }
}

pub async fn start(
    manager: &Mutex<TunnelManager>,
    session_id: &str,
    handle: SharedHandle,
    table: RemoteForwardTable,
    spec: TunnelSpec,
) -> AppResult<TunnelStatus> {
    let id = Uuid::new_v4().to_string();
    let (shutdown_tx, shutdown_rx) = mpsc::channel::<()>(1);
    let active = Arc::new(AtomicU64::new(0));
    let total = Arc::new(AtomicU64::new(0));

    let mut status = TunnelStatus {
        id: id.clone(),
        session_id: session_id.to_string(),
        name: spec.name.clone(),
        kind: spec.kind,
        bind_host: spec.bind_host.clone(),
        bind_port: spec.bind_port,
        target_host: spec.target_host.clone(),
        target_port: spec.target_port,
        active_connections: 0,
        total_connections: 0,
        error: None,
    };

    let mut bind_port_effective = spec.bind_port;

    match spec.kind {
        TunnelKind::Local => {
            let listener = bind_listener(&spec.bind_host, spec.bind_port).await?;
            bind_port_effective = listener
                .local_addr()
                .map(|a| a.port())
                .unwrap_or(spec.bind_port);
            spawn_local_loop(
                listener,
                handle.clone(),
                spec.target_host.clone(),
                spec.target_port,
                active.clone(),
                total.clone(),
                shutdown_rx,
                false,
            );
        }
        TunnelKind::Dynamic => {
            let listener = bind_listener(&spec.bind_host, spec.bind_port).await?;
            bind_port_effective = listener
                .local_addr()
                .map(|a| a.port())
                .unwrap_or(spec.bind_port);
            spawn_local_loop(
                listener,
                handle.clone(),
                spec.target_host.clone(),
                spec.target_port,
                active.clone(),
                total.clone(),
                shutdown_rx,
                true,
            );
        }
        TunnelKind::Remote => {
            {
                let mut h = handle.lock().await;
                let assigned = h
                    .tcpip_forward(spec.bind_host.clone(), spec.bind_port as u32)
                    .await
                    .map_err(|e| AppError::Ssh(format!("Remote forward request failed: {}", e)))?;
                if spec.bind_port == 0 && assigned != 0 {
                    bind_port_effective = assigned as u16;
                }
            }
            table.lock().await.insert(
                bind_port_effective as u32,
                RemoteForward {
                    target_host: spec.target_host.clone(),
                    target_port: spec.target_port,
                },
            );
            drop(shutdown_rx);
        }
    }

    status.bind_port = bind_port_effective;

    let tunnel = Tunnel {
        status: status.clone(),
        active,
        total,
        shutdown: shutdown_tx,
        kind: spec.kind,
        bind_port_effective,
    };

    let snap = tunnel.snapshot();
    manager.lock().await.tunnels.insert(id, tunnel);
    Ok(snap)
}

async fn bind_listener(host: &str, port: u16) -> AppResult<TcpListener> {
    let host = if host.is_empty() { "127.0.0.1" } else { host };
    TcpListener::bind((host, port))
        .await
        .map_err(|e| AppError::Ssh(format!("Cannot bind {}:{} — {}", host, port, e)))
}

#[allow(clippy::too_many_arguments)]
fn spawn_local_loop(
    listener: TcpListener,
    handle: SharedHandle,
    target_host: String,
    target_port: u16,
    active: Arc<AtomicU64>,
    total: Arc<AtomicU64>,
    mut shutdown_rx: mpsc::Receiver<()>,
    socks: bool,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => break,
                accepted = listener.accept() => {
                    let Ok((inbound, peer)) = accepted else { break };
                    inbound.set_nodelay(true).ok();
                    let handle = handle.clone();
                    let active = active.clone();
                    let total = total.clone();
                    let target_host = target_host.clone();
                    tokio::spawn(async move {
                        total.fetch_add(1, Ordering::Relaxed);
                        active.fetch_add(1, Ordering::Relaxed);
                        let res = if socks {
                            handle_socks_conn(inbound, handle).await
                        } else {
                            handle_direct_conn(inbound, handle, &target_host, target_port).await
                        };
                        if let Err(e) = res {
                            log::debug!("tunnel conn from {} ended: {}", peer, e);
                        }
                        active.fetch_sub(1, Ordering::Relaxed);
                    });
                }
            }
        }
    });
}

async fn handle_direct_conn(
    mut inbound: tokio::net::TcpStream,
    handle: SharedHandle,
    target_host: &str,
    target_port: u16,
) -> AppResult<()> {
    let channel = {
        let h = handle.lock().await;
        h.channel_open_direct_tcpip(target_host.to_string(), target_port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| AppError::Ssh(format!("direct-tcpip open failed: {}", e)))?
    };
    let mut stream = channel.into_stream();
    tokio::io::copy_bidirectional(&mut inbound, &mut stream)
        .await
        .map_err(AppError::Io)?;
    Ok(())
}

async fn handle_socks_conn(
    mut inbound: tokio::net::TcpStream,
    handle: SharedHandle,
) -> AppResult<()> {
    let mut hdr = [0u8; 2];
    inbound.read_exact(&mut hdr).await?;
    if hdr[0] != 0x05 {
        return Err(AppError::Ssh("Only SOCKS5 is supported".into()));
    }
    let n_methods = hdr[1] as usize;
    let mut methods = vec![0u8; n_methods];
    inbound.read_exact(&mut methods).await?;
    inbound.write_all(&[0x05, 0x00]).await?;

    let mut req = [0u8; 4];
    inbound.read_exact(&mut req).await?;
    if req[1] != 0x01 {
        inbound
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(AppError::Ssh("SOCKS5 command not supported".into()));
    }

    let dest_host = match req[3] {
        0x01 => {
            let mut a = [0u8; 4];
            inbound.read_exact(&mut a).await?;
            std::net::Ipv4Addr::from(a).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            inbound.read_exact(&mut len).await?;
            let mut d = vec![0u8; len[0] as usize];
            inbound.read_exact(&mut d).await?;
            String::from_utf8_lossy(&d).to_string()
        }
        0x04 => {
            let mut a = [0u8; 16];
            inbound.read_exact(&mut a).await?;
            std::net::Ipv6Addr::from(a).to_string()
        }
        _ => {
            inbound
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(AppError::Ssh("SOCKS5 address type not supported".into()));
        }
    };
    let mut port_bytes = [0u8; 2];
    inbound.read_exact(&mut port_bytes).await?;
    let dest_port = u16::from_be_bytes(port_bytes);

    let channel = {
        let h = handle.lock().await;
        h.channel_open_direct_tcpip(dest_host.clone(), dest_port as u32, "127.0.0.1", 0)
            .await
    };

    match channel {
        Ok(channel) => {
            inbound
                .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            let mut stream = channel.into_stream();
            tokio::io::copy_bidirectional(&mut inbound, &mut stream)
                .await
                .map_err(AppError::Io)?;
            Ok(())
        }
        Err(e) => {
            inbound
                .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            Err(AppError::Ssh(format!("SOCKS5 upstream failed: {}", e)))
        }
    }
}
