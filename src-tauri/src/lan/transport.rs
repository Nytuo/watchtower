use snow::{Builder, TransportState};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::{AppError, AppResult};

pub const PARAMS_XX: &str = "Noise_XX_25519_ChaChaPoly_SHA256";
pub const PARAMS_XXPSK3: &str = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";

pub const MODE_PAIR_QR: u8 = 1;
pub const MODE_PAIR_CODE: u8 = 2;
pub const MODE_SYNC: u8 = 3;

const MAX_HANDSHAKE_FRAME: usize = 1024;
const CHUNK: usize = 60_000;
pub const MAX_MSG: usize = 32 * 1024 * 1024;

fn err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::General(format!("sync transport: {e}"))
}

pub async fn write_frame<S: AsyncWrite + Unpin>(io: &mut S, data: &[u8]) -> AppResult<()> {
    if data.len() > u16::MAX as usize {
        return Err(err("frame too large"));
    }
    io.write_all(&(data.len() as u16).to_be_bytes())
        .await
        .map_err(err)?;
    io.write_all(data).await.map_err(err)?;
    io.flush().await.map_err(err)
}

pub async fn read_frame<S: AsyncRead + Unpin>(io: &mut S, max: usize) -> AppResult<Vec<u8>> {
    let mut l = [0u8; 2];
    io.read_exact(&mut l).await.map_err(err)?;
    let n = u16::from_be_bytes(l) as usize;
    if n > max {
        return Err(err("frame exceeds limit"));
    }
    let mut buf = vec![0u8; n];
    io.read_exact(&mut buf).await.map_err(err)?;
    Ok(buf)
}

pub struct Secure<S> {
    io: S,
    noise: TransportState,
    pub remote_static: Vec<u8>,
    pub handshake_hash: Vec<u8>,
    rx: Vec<u8>,
}

pub fn sas(handshake_hash: &[u8]) -> String {
    let n = u32::from_be_bytes([
        handshake_hash[0],
        handshake_hash[1],
        handshake_hash[2],
        handshake_hash[3],
    ]) % 1_000_000;
    format!("{:03} {:03}", n / 1000, n % 1000)
}

async fn run_handshake<S: AsyncRead + AsyncWrite + Unpin>(
    mut io: S,
    local_priv: &[u8],
    psk: Option<&[u8; 32]>,
    initiator: bool,
) -> AppResult<Secure<S>> {
    let params = if psk.is_some() {
        PARAMS_XXPSK3
    } else {
        PARAMS_XX
    };
    let mut b = Builder::new(params.parse().map_err(err)?)
        .local_private_key(local_priv)
        .map_err(err)?;
    if let Some(p) = psk {
        b = b.psk(3, p).map_err(err)?;
    }
    let mut hs = if initiator {
        b.build_initiator().map_err(err)?
    } else {
        b.build_responder().map_err(err)?
    };
    let mut buf = vec![0u8; MAX_HANDSHAKE_FRAME];

    let mut my_turn = initiator;
    for _ in 0..3 {
        if my_turn {
            let n = hs.write_message(&[], &mut buf).map_err(err)?;
            write_frame(&mut io, &buf[..n]).await?;
        } else {
            let f = read_frame(&mut io, MAX_HANDSHAKE_FRAME).await?;
            hs.read_message(&f, &mut buf).map_err(err)?;
        }
        my_turn = !my_turn;
    }
    if !hs.is_handshake_finished() {
        return Err(err("handshake incomplete"));
    }
    let remote_static = hs
        .get_remote_static()
        .ok_or_else(|| err("no remote key"))?
        .to_vec();
    let handshake_hash = hs.get_handshake_hash().to_vec();
    let noise = hs.into_transport_mode().map_err(err)?;
    Ok(Secure {
        io,
        noise,
        remote_static,
        handshake_hash,
        rx: Vec::new(),
    })
}

pub async fn connect<S: AsyncRead + AsyncWrite + Unpin>(
    io: S,
    local_priv: &[u8],
    psk: Option<&[u8; 32]>,
) -> AppResult<Secure<S>> {
    run_handshake(io, local_priv, psk, true).await
}

pub async fn accept<S: AsyncRead + AsyncWrite + Unpin>(
    io: S,
    local_priv: &[u8],
    psk: Option<&[u8; 32]>,
) -> AppResult<Secure<S>> {
    run_handshake(io, local_priv, psk, false).await
}

impl<S: AsyncRead + AsyncWrite + Unpin> Secure<S> {
    pub async fn send(&mut self, msg: &[u8]) -> AppResult<()> {
        if msg.len() > MAX_MSG {
            return Err(err("message too large"));
        }
        let mut stream = Vec::with_capacity(4 + msg.len());
        stream.extend_from_slice(&(msg.len() as u32).to_be_bytes());
        stream.extend_from_slice(msg);
        let mut out = vec![0u8; CHUNK + 64];
        for chunk in stream.chunks(CHUNK) {
            let n = self.noise.write_message(chunk, &mut out).map_err(err)?;
            write_frame(&mut self.io, &out[..n]).await?;
        }
        Ok(())
    }

    pub async fn recv(&mut self) -> AppResult<Vec<u8>> {
        let mut plain = vec![0u8; CHUNK + 64];
        loop {
            if self.rx.len() >= 4 {
                let total =
                    u32::from_be_bytes([self.rx[0], self.rx[1], self.rx[2], self.rx[3]]) as usize;
                if total > MAX_MSG {
                    return Err(err("message exceeds limit"));
                }
                if self.rx.len() >= 4 + total {
                    let msg = self.rx[4..4 + total].to_vec();
                    self.rx.drain(..4 + total);
                    return Ok(msg);
                }
            }
            let f = read_frame(&mut self.io, u16::MAX as usize).await?;
            let n = self.noise.read_message(&f, &mut plain).map_err(err)?;
            self.rx.extend_from_slice(&plain[..n]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keypair() -> snow::Keypair {
        Builder::new(PARAMS_XX.parse().unwrap())
            .generate_keypair()
            .unwrap()
    }

    #[tokio::test]
    async fn xx_roundtrip_and_large_message() {
        let (a, b) = tokio::io::duplex(1 << 20);
        let (ka, kb) = (keypair(), keypair());
        let (pa, pb) = (ka.public.clone(), kb.public.clone());
        let t = tokio::spawn(async move {
            let mut s = accept(b, &kb.private, None).await.unwrap();
            assert_eq!(s.remote_static, pa);
            let m = s.recv().await.unwrap();
            s.send(&m).await.unwrap();
        });
        let mut c = connect(a, &ka.private, None).await.unwrap();
        assert_eq!(c.remote_static, pb);
        let big: Vec<u8> = (0..300_000u32).map(|x| x as u8).collect();
        c.send(&big).await.unwrap();
        assert_eq!(c.recv().await.unwrap(), big);
        t.await.unwrap();
    }

    #[tokio::test]
    async fn psk_mismatch_fails() {
        let (a, b) = tokio::io::duplex(1 << 16);
        let (ka, kb) = (keypair(), keypair());
        let t =
            tokio::spawn(async move { accept(b, &kb.private, Some(&[2u8; 32])).await.is_err() });
        let _ = connect(a, &ka.private, Some(&[1u8; 32])).await;
        assert!(t.await.unwrap());
    }

    #[tokio::test]
    async fn sas_matches_on_both_sides() {
        let (a, b) = tokio::io::duplex(1 << 16);
        let (ka, kb) = (keypair(), keypair());
        let t =
            tokio::spawn(async move { accept(b, &kb.private, Some(&[7u8; 32])).await.unwrap() });
        let c = connect(a, &ka.private, Some(&[7u8; 32])).await.unwrap();
        let s = t.await.unwrap();
        assert_eq!(sas(&c.handshake_hash), sas(&s.handshake_hash));
    }
}
