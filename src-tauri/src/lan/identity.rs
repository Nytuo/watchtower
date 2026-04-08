use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub const NOISE_DH_LEN: usize = 32;

pub const RID_WINDOW_SECS: u64 = 300;

pub fn to_hex(b: &[u8]) -> String {
    data_encoding::HEXLOWER.encode(b)
}

pub fn unhex(s: &str) -> Option<Vec<u8>> {
    data_encoding::HEXLOWER.decode(s.as_bytes()).ok()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub label: String,
    pub public_key: String,
    pub pair_secret: String,
    pub added_at: u64,
    pub last_sync: Option<u64>,

    pub confirmed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Identity {
    pub private_key: String,
    pub public_key: String,
    pub peers: Vec<Peer>,
}

pub fn peer_id(public_key: &[u8]) -> String {
    to_hex(&Sha256::digest(public_key)[..16])
}

impl Identity {
    pub fn generate() -> AppResult<Self> {
        let params: snow::params::NoiseParams = super::transport::PARAMS_XX
            .parse()
            .map_err(|e| AppError::Crypto(format!("noise params: {e}")))?;
        let kp = snow::Builder::new(params)
            .generate_keypair()
            .map_err(|e| AppError::Crypto(format!("keygen: {e}")))?;
        Ok(Self {
            private_key: to_hex(&kp.private),
            public_key: to_hex(&kp.public),
            peers: Vec::new(),
        })
    }

    pub fn private_bytes(&self) -> Vec<u8> {
        unhex(&self.private_key).unwrap_or_default()
    }

    pub fn public_bytes(&self) -> Vec<u8> {
        unhex(&self.public_key).unwrap_or_default()
    }

    pub fn fingerprint(&self) -> String {
        peer_id(&self.public_bytes())
    }

    pub fn find_by_key(&self, public_key: &[u8]) -> Option<&Peer> {
        let k = to_hex(public_key);
        self.peers.iter().find(|p| p.public_key == k)
    }

    pub fn upsert(&mut self, peer: Peer) {
        match self.peers.iter_mut().find(|p| p.id == peer.id) {
            Some(existing) => *existing = peer,
            None => self.peers.push(peer),
        }
    }
}

pub fn identity_path(data_dir: &Path) -> PathBuf {
    data_dir.join("sync_identity.json")
}

pub fn load_or_create(path: &Path) -> AppResult<Identity> {
    if let Ok(raw) = std::fs::read(path) {
        if let Ok(id) = serde_json::from_slice::<Identity>(&raw) {
            if id.private_bytes().len() == NOISE_DH_LEN {
                return Ok(id);
            }
        }
    }
    let id = Identity::generate()?;
    save(path, &id)?;
    Ok(id)
}

pub fn save(path: &Path, id: &Identity) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(id)?;
    let tmp = path.with_extension("tmp");
    crate::vault::store::write_private(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn rid(pair_secret: &[u8], window: u64) -> String {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(pair_secret).expect("hmac key");
    mac.update(b"watchtower-rid");
    mac.update(&window.to_be_bytes());
    to_hex(&mac.finalize().into_bytes()[..8])
}

pub fn current_window() -> u64 {
    now_secs() / RID_WINDOW_SECS
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    rand::thread_rng().fill_bytes(&mut b);
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rid_rotates_and_is_keyed() {
        let a = rid(b"secret-a", 10);
        assert_eq!(a, rid(b"secret-a", 10));
        assert_ne!(a, rid(b"secret-a", 11));
        assert_ne!(a, rid(b"secret-b", 10));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn identity_roundtrip() {
        let dir = std::env::temp_dir().join(format!("wt-id-{}", to_hex(&random_bytes::<4>())));
        let p = identity_path(&dir);
        let a = load_or_create(&p).unwrap();
        let b = load_or_create(&p).unwrap();
        assert_eq!(a.public_key, b.public_key);
        assert_eq!(a.fingerprint().len(), 32);
        let _ = std::fs::remove_dir_all(dir);
    }
}
