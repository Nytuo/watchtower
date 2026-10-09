use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncRead, AsyncWrite};

use super::identity::{random_bytes, to_hex, unhex};
use super::transport::{read_frame, write_frame, Secure};
use crate::error::{AppError, AppResult};

pub const PROTO: u8 = 1;

fn err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::General(format!("sync protocol: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hello {
    pub proto: u8,
    pub vault_id: String,
    pub state_hash: String,

    #[serde(default)]
    pub pull: bool,
}

#[derive(Debug, PartialEq)]
pub enum Exchange {
    Served,
    UpToDate,
    DifferentVault,

    Received(Vec<u8>),
}

fn decide(local: &Hello, remote: &Hello) -> Option<Exchange> {
    if remote.proto != PROTO {
        return Some(Exchange::DifferentVault);
    }
    let pull = local.pull || remote.pull;
    if !pull
        && !local.vault_id.is_empty()
        && !remote.vault_id.is_empty()
        && local.vault_id != remote.vault_id
    {
        return Some(Exchange::DifferentVault);
    }
    if !pull && local.state_hash == remote.state_hash {
        return Some(Exchange::UpToDate);
    }
    None
}

pub async fn sync_initiator<S: AsyncRead + AsyncWrite + Unpin>(
    sec: &mut Secure<S>,
    local: &Hello,
    blob: &[u8],
) -> AppResult<Exchange> {
    sec.send(&serde_json::to_vec(local)?).await?;
    let remote: Hello = serde_json::from_slice(&sec.recv().await?).map_err(err)?;
    if let Some(done) = decide(local, &remote) {
        return Ok(done);
    }
    sec.send(blob).await?;
    Ok(Exchange::Received(sec.recv().await?))
}

pub async fn sync_responder<S: AsyncRead + AsyncWrite + Unpin>(
    sec: &mut Secure<S>,
    local: &Hello,
    blob: &[u8],
) -> AppResult<Exchange> {
    let remote: Hello = serde_json::from_slice(&sec.recv().await?).map_err(err)?;
    sec.send(&serde_json::to_vec(local)?).await?;
    if let Some(done) = decide(local, &remote) {
        return Ok(done);
    }
    let theirs = sec.recv().await?;
    sec.send(blob).await?;
    if remote.pull {
        return Ok(Exchange::Served);
    }
    Ok(Exchange::Received(theirs))
}

#[derive(Serialize, Deserialize)]
struct PairHello {
    label: String,
    contribution: String,
}

pub struct Paired {
    pub remote_label: String,
    pub pair_secret: [u8; 32],
}

fn pair_secret(init: &[u8], resp: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"watchtower-pair");
    h.update(init);
    h.update(resp);
    h.finalize().into()
}

fn clean_label(s: String) -> String {
    s.chars().filter(|c| !c.is_control()).take(48).collect()
}

pub async fn pair_initiator<S: AsyncRead + AsyncWrite + Unpin>(
    sec: &mut Secure<S>,
    label: &str,
) -> AppResult<Paired> {
    let mine = random_bytes::<32>();
    let hello = PairHello {
        label: label.to_string(),
        contribution: to_hex(&mine),
    };
    sec.send(&serde_json::to_vec(&hello)?).await?;
    let theirs: PairHello = serde_json::from_slice(&sec.recv().await?).map_err(err)?;
    let tc = unhex(&theirs.contribution)
        .filter(|c| c.len() == 32)
        .ok_or_else(|| err("bad contribution"))?;
    Ok(Paired {
        remote_label: clean_label(theirs.label),
        pair_secret: pair_secret(&mine, &tc),
    })
}

pub async fn pair_responder<S: AsyncRead + AsyncWrite + Unpin>(
    sec: &mut Secure<S>,
    label: &str,
) -> AppResult<Paired> {
    let theirs: PairHello = serde_json::from_slice(&sec.recv().await?).map_err(err)?;
    let tc = unhex(&theirs.contribution)
        .filter(|c| c.len() == 32)
        .ok_or_else(|| err("bad contribution"))?;
    let mine = random_bytes::<32>();
    let hello = PairHello {
        label: label.to_string(),
        contribution: to_hex(&mine),
    };
    sec.send(&serde_json::to_vec(&hello)?).await?;
    Ok(Paired {
        remote_label: clean_label(theirs.label),
        pair_secret: pair_secret(&tc, &mine),
    })
}

pub async fn spake_key<S: AsyncRead + AsyncWrite + Unpin>(
    io: &mut S,
    code: &str,
) -> AppResult<[u8; 32]> {
    use spake2::{Ed25519Group, Identity, Password, Spake2};
    let norm: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let (state, msg) = Spake2::<Ed25519Group>::start_symmetric(
        &Password::new(norm.as_bytes()),
        &Identity::new(b"watchtower-pair"),
    );
    write_frame(io, &msg).await?;
    let other = read_frame(io, 64).await?;
    let key = state
        .finish(&other)
        .map_err(|_| err("pairing code mismatch"))?;
    Ok(Sha256::digest(&key).into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QrPayload {
    pub v: u8,
    pub addrs: Vec<String>,
    pub secret: String,
    pub fp: String,
}

const QR_PREFIX: &str = "wt1:";

impl QrPayload {
    pub fn encode(&self) -> String {
        format!(
            "{}{}",
            QR_PREFIX,
            data_encoding::BASE64URL_NOPAD.encode(&serde_json::to_vec(self).unwrap_or_default())
        )
    }

    pub fn decode(s: &str) -> AppResult<Self> {
        let body = s
            .trim()
            .strip_prefix(QR_PREFIX)
            .ok_or_else(|| err("not a Watchtower pairing code"))?;
        let raw = data_encoding::BASE64URL_NOPAD
            .decode(body.as_bytes())
            .map_err(err)?;
        let p: QrPayload = serde_json::from_slice(&raw).map_err(err)?;
        if p.v != 1 || unhex(&p.secret).map(|s| s.len()) != Some(32) {
            return Err(err("unsupported pairing code"));
        }
        Ok(p)
    }

    pub fn secret_bytes(&self) -> [u8; 32] {
        let mut out = [0u8; 32];
        if let Some(b) = unhex(&self.secret) {
            out.copy_from_slice(&b);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan::transport::{accept, connect, PARAMS_XX};

    fn kp() -> snow::Keypair {
        snow::Builder::new(PARAMS_XX.parse().unwrap())
            .generate_keypair()
            .unwrap()
    }

    async fn pair_up() -> (
        Secure<tokio::io::DuplexStream>,
        Secure<tokio::io::DuplexStream>,
    ) {
        let (a, b) = tokio::io::duplex(1 << 20);
        let (ka, kb) = (kp(), kp());
        let t = tokio::spawn(async move { accept(b, &kb.private, None).await.unwrap() });
        let c = connect(a, &ka.private, None).await.unwrap();
        (c, t.await.unwrap())
    }

    fn hello(id: &str, h: &str) -> Hello {
        Hello {
            proto: PROTO,
            vault_id: id.into(),
            state_hash: h.into(),
            pull: false,
        }
    }

    #[tokio::test]
    async fn equal_state_is_up_to_date() {
        let (mut c, mut s) = pair_up().await;
        let t = tokio::spawn(async move {
            sync_responder(&mut s, &hello("v", "h"), b"B")
                .await
                .unwrap()
        });
        let r = sync_initiator(&mut c, &hello("v", "h"), b"A")
            .await
            .unwrap();
        assert_eq!(r, Exchange::UpToDate);
        assert_eq!(t.await.unwrap(), Exchange::UpToDate);
    }

    #[tokio::test]
    async fn different_vault_refused() {
        let (mut c, mut s) = pair_up().await;
        let t = tokio::spawn(async move {
            sync_responder(&mut s, &hello("x", "h1"), b"B")
                .await
                .unwrap()
        });
        let r = sync_initiator(&mut c, &hello("y", "h2"), b"A")
            .await
            .unwrap();
        assert_eq!(r, Exchange::DifferentVault);
        assert_eq!(t.await.unwrap(), Exchange::DifferentVault);
    }

    #[tokio::test]
    async fn divergent_state_swaps_blobs() {
        let (mut c, mut s) = pair_up().await;
        let big = vec![9u8; 200_000];
        let big2 = big.clone();
        let t = tokio::spawn(async move {
            sync_responder(&mut s, &hello("v", "h2"), &big2)
                .await
                .unwrap()
        });
        let r = sync_initiator(&mut c, &hello("v", "h1"), b"A")
            .await
            .unwrap();
        assert_eq!(r, Exchange::Received(big));
        assert_eq!(t.await.unwrap(), Exchange::Received(b"A".to_vec()));
    }

    #[tokio::test]
    async fn pull_merges_across_different_vaults_and_serves_without_applying() {
        let (mut c, mut s) = pair_up().await;
        let t = tokio::spawn(async move {
            sync_responder(&mut s, &hello("x", "h1"), b"B")
                .await
                .unwrap()
        });
        let mut h = hello("y", "h2");
        h.pull = true;
        let r = sync_initiator(&mut c, &h, b"A").await.unwrap();
        assert_eq!(r, Exchange::Received(b"B".to_vec()));
        assert_eq!(t.await.unwrap(), Exchange::Served);
    }

    #[tokio::test]
    async fn pairing_derives_same_secret() {
        let (mut c, mut s) = pair_up().await;
        let t = tokio::spawn(async move { pair_responder(&mut s, "desktop").await.unwrap() });
        let a = pair_initiator(&mut c, "phone").await.unwrap();
        let b = t.await.unwrap();
        assert_eq!(a.pair_secret, b.pair_secret);
        assert_eq!(a.remote_label, "desktop");
        assert_eq!(b.remote_label, "phone");
    }

    #[tokio::test]
    async fn spake_same_code_same_key_wrong_code_differs() {
        let (mut a, mut b) = tokio::io::duplex(4096);
        let t = tokio::spawn(async move { spake_key(&mut b, "123-456").await.unwrap() });
        let ka = spake_key(&mut a, "123456").await.unwrap();
        assert_eq!(ka, t.await.unwrap());

        let (mut a, mut b) = tokio::io::duplex(4096);
        let t = tokio::spawn(async move { spake_key(&mut b, "111111").await.unwrap() });
        let ka = spake_key(&mut a, "222222").await.unwrap();
        assert_ne!(ka, t.await.unwrap());
    }

    #[test]
    fn qr_roundtrip() {
        let p = QrPayload {
            v: 1,
            addrs: vec!["192.168.1.2:5000".into()],
            secret: to_hex(&[3u8; 32]),
            fp: "ab".into(),
        };
        let d = QrPayload::decode(&p.encode()).unwrap();
        assert_eq!(d.addrs, p.addrs);
        assert_eq!(d.secret_bytes(), [3u8; 32]);
        assert!(QrPayload::decode("junk").is_err());
    }
}
