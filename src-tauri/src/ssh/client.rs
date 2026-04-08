use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use russh::client::{self, Handler, Msg};
use russh::keys::key::PublicKey;
use russh::{Channel, ChannelId};
use tokio::sync::{mpsc, Mutex};

use crate::error::AppError;
use crate::vault::schema::{HostKeyPolicy, KnownHost};

#[derive(Debug)]
pub enum SshEvent {
    Data(Vec<u8>),
    Eof,
    Close,
}

#[derive(Debug, Clone)]
pub enum HostKeyOutcome {
    None,
    Verified {
        fingerprint: String,
        key_type: String,
    },
    AcceptedNew {
        fingerprint: String,
        key_type: String,
    },
    Mismatch {
        expected: String,
        got: String,
        key_type: String,
    },
    UnknownRejected {
        fingerprint: String,
        key_type: String,
    },
}

pub type HostKeyOutcomeSlot = Arc<Mutex<HostKeyOutcome>>;

#[derive(Debug, Clone)]
pub struct RemoteForward {
    pub target_host: String,
    pub target_port: u16,
}

pub type RemoteForwardTable = Arc<Mutex<HashMap<u32, RemoteForward>>>;

pub struct SshHandler {
    pub event_tx: mpsc::UnboundedSender<SshEvent>,
    pub remote_forwards: RemoteForwardTable,

    pub host: String,
    pub port: u16,
    pub known_hosts: Vec<KnownHost>,
    pub host_key_policy: HostKeyPolicy,
    pub host_key_outcome: HostKeyOutcomeSlot,
}

#[async_trait]
impl Handler for SshHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        let key_type = server_public_key.name().to_string();

        let known = self
            .known_hosts
            .iter()
            .find(|k| k.host == self.host && k.port == self.port);

        let (outcome, accept) = match known {
            Some(k) if k.key_fingerprint == fingerprint => (
                HostKeyOutcome::Verified {
                    fingerprint,
                    key_type,
                },
                true,
            ),
            Some(k) => (
                HostKeyOutcome::Mismatch {
                    expected: k.key_fingerprint.clone(),
                    got: fingerprint,
                    key_type,
                },
                false,
            ),
            None => match self.host_key_policy {
                HostKeyPolicy::Strict => (
                    HostKeyOutcome::UnknownRejected {
                        fingerprint,
                        key_type,
                    },
                    false,
                ),
                _ => (
                    HostKeyOutcome::AcceptedNew {
                        fingerprint,
                        key_type,
                    },
                    true,
                ),
            },
        };

        *self.host_key_outcome.lock().await = outcome;
        Ok(accept)
    }

    async fn data(
        &mut self,
        _channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.event_tx.send(SshEvent::Data(data.to_vec()));
        Ok(())
    }

    async fn extended_data(
        &mut self,
        _channel: ChannelId,
        _ext: u32,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.event_tx.send(SshEvent::Data(data.to_vec()));
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        _channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.event_tx.send(SshEvent::Eof);
        Ok(())
    }

    async fn channel_close(
        &mut self,
        _channel: ChannelId,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let _ = self.event_tx.send(SshEvent::Close);
        Ok(())
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        connected_address: &str,
        connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let target = {
            let table = self.remote_forwards.lock().await;
            table
                .get(&connected_port)
                .or_else(|| table.get(&0))
                .cloned()
        };

        let Some(target) = target else {
            log::warn!(
                "No remote-forward route for {}:{}",
                connected_address,
                connected_port
            );
            return Ok(());
        };

        tokio::spawn(async move {
            let addr = format!("{}:{}", target.target_host, target.target_port);
            match tokio::net::TcpStream::connect(&addr).await {
                Ok(mut tcp) => {
                    let mut stream = channel.into_stream();
                    let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
                }
                Err(e) => {
                    log::warn!("Remote-forward dial to {} failed: {}", addr, e);
                }
            }
        });

        Ok(())
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        #[cfg(unix)]
        {
            if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
                tokio::spawn(async move {
                    if let Ok(mut agent) = tokio::net::UnixStream::connect(&sock).await {
                        let mut stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut stream, &mut agent).await;
                    }
                });
            } else {
                log::warn!("agent forwarding requested but SSH_AUTH_SOCK is not set");
            }
        }
        #[cfg(not(unix))]
        let _ = channel;
        Ok(())
    }

    async fn server_channel_open_x11(
        &mut self,
        channel: Channel<Msg>,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let display = std::env::var("DISPLAY").unwrap_or_else(|_| ":0".into());
        tokio::spawn(async move {
            let dest = x11_target(&display);
            match dest {
                Some(X11Target::Unix(path)) => {
                    #[cfg(unix)]
                    if let Ok(mut local) = tokio::net::UnixStream::connect(&path).await {
                        let mut stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut stream, &mut local).await;
                    }
                    #[cfg(not(unix))]
                    let _ = path;
                }
                Some(X11Target::Tcp(addr)) => {
                    if let Ok(mut local) = tokio::net::TcpStream::connect(&addr).await {
                        let mut stream = channel.into_stream();
                        let _ = tokio::io::copy_bidirectional(&mut stream, &mut local).await;
                    }
                }
                None => log::warn!("could not resolve X11 DISPLAY {}", display),
            }
        });
        Ok(())
    }
}

enum X11Target {
    Unix(String),
    Tcp(String),
}

fn x11_target(display: &str) -> Option<X11Target> {
    // ":N" / ":N.S" -> unix socket; "host:N" -> tcp 6000+N
    let (host, rest) = display.rsplit_once(':')?;
    let screen = rest.split('.').next().unwrap_or("0");
    let n: u16 = screen.parse().ok()?;
    if host.is_empty() {
        Some(X11Target::Unix(format!("/tmp/.X11-unix/X{}", n)))
    } else {
        Some(X11Target::Tcp(format!("{}:{}", host, 6000 + n)))
    }
}
