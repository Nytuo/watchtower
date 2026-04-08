use async_trait::async_trait;
use russh::client::{self, Handler};
use russh::keys::key::PublicKey;
use russh::ChannelId;
use tokio::sync::mpsc;

use crate::error::AppError;

#[derive(Debug)]
pub enum SshEvent {
    Data(Vec<u8>),
    Eof,
    Close,
}

pub struct SshHandler {
    pub event_tx: mpsc::UnboundedSender<SshEvent>,
}

#[async_trait]
impl Handler for SshHandler {
    type Error = AppError;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
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
}
