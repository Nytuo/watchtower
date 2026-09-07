use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const ARGON2_MEMORY_KB: u32 = 65536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

pub const VAULT_MAGIC: &[u8; 4] = b"NYTF";
pub const VAULT_VERSION_V1: u8 = 0x01;
pub const VAULT_VERSION_V2: u8 = 0x02;

pub const HEADER_SIZE: usize = 57;

#[derive(Clone)]
pub struct Kdf {
    pub salt: [u8; 16],
    pub mem: u32,
    pub time: u32,
    pub par: u32,
}

impl Kdf {
    pub fn new_random() -> Self {
        let mut salt = [0u8; 16];
        rand::thread_rng().fill_bytes(&mut salt);
        Self {
            salt,
            mem: ARGON2_MEMORY_KB,
            time: ARGON2_TIME_COST,
            par: ARGON2_PARALLELISM,
        }
    }
}

pub fn derive_key(password: &str, kdf: &Kdf) -> AppResult<Zeroizing<[u8; 32]>> {
    let params = Params::new(kdf.mem, kdf.time, kdf.par, Some(32))
        .map_err(|e| AppError::Crypto(format!("Argon2 params error: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), &kdf.salt, key.as_mut())
        .map_err(|e| AppError::Crypto(format!("Argon2 hash error: {}", e)))?;

    Ok(key)
}

pub fn keys_equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn header_bytes(kdf: &Kdf, nonce: &[u8; 24]) -> Vec<u8> {
    let mut h = Vec::with_capacity(HEADER_SIZE);
    h.extend_from_slice(VAULT_MAGIC);
    h.push(VAULT_VERSION_V2);
    h.extend_from_slice(&kdf.salt);
    h.extend_from_slice(nonce);
    h.extend_from_slice(&kdf.mem.to_le_bytes());
    h.extend_from_slice(&kdf.time.to_le_bytes());
    h.extend_from_slice(&kdf.par.to_le_bytes());
    h
}

pub fn encrypt(plaintext: &[u8], kdf: &Kdf, key: &[u8; 32]) -> AppResult<Vec<u8>> {
    let mut nonce_bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| AppError::Crypto(format!("Cipher init error: {}", e)))?;

    let header = header_bytes(kdf, &nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: &header,
            },
        )
        .map_err(|e| AppError::Crypto(format!("Encryption error: {}", e)))?;

    let mut output = header;
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decrypt(data: &[u8], password: &str) -> AppResult<(Vec<u8>, Kdf, Zeroizing<[u8; 32]>)> {
    if data.len() < HEADER_SIZE {
        return Err(AppError::Crypto("Vault file too short".into()));
    }
    if &data[0..4] != VAULT_MAGIC {
        return Err(AppError::Crypto("Invalid vault file magic".into()));
    }

    let version = data[4];
    if version != VAULT_VERSION_V1 && version != VAULT_VERSION_V2 {
        return Err(AppError::Crypto(format!(
            "Unsupported vault version: {}",
            version
        )));
    }

    let mut salt = [0u8; 16];
    salt.copy_from_slice(&data[5..21]);

    let mut nonce_bytes = [0u8; 24];
    nonce_bytes.copy_from_slice(&data[21..45]);

    let mem = u32::from_le_bytes(data[45..49].try_into().unwrap());
    let time = u32::from_le_bytes(data[49..53].try_into().unwrap());
    let par = u32::from_le_bytes(data[53..57].try_into().unwrap());

    let kdf = Kdf {
        salt,
        mem: if mem == 0 { ARGON2_MEMORY_KB } else { mem },
        time: if time == 0 { ARGON2_TIME_COST } else { time },
        par: if par == 0 { ARGON2_PARALLELISM } else { par },
    };

    let ciphertext = &data[HEADER_SIZE..];
    let key = derive_key(password, &kdf)?;

    let cipher = XChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|e| AppError::Crypto(format!("Cipher init error: {}", e)))?;
    let nonce = XNonce::from_slice(&nonce_bytes);

    let plaintext = if version == VAULT_VERSION_V2 {
        cipher.decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: &data[..HEADER_SIZE],
            },
        )
    } else {
        cipher.decrypt(nonce, ciphertext)
    }
    .map_err(|_| {
        AppError::Crypto("Decryption failed — wrong password or corrupted vault".into())
    })?;

    Ok((plaintext, kdf, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let kdf = Kdf::new_random();
        let key = derive_key("test-password-123", &kdf).unwrap();
        let plaintext = b"Hello, Watchtower vault!";

        let encrypted = encrypt(plaintext, &kdf, &key).unwrap();
        let (decrypted, _, _) = decrypt(&encrypted, "test-password-123").unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_wrong_password_fails() {
        let kdf = Kdf::new_random();
        let key = derive_key("correct", &kdf).unwrap();
        let encrypted = encrypt(b"secret data", &kdf, &key).unwrap();
        assert!(decrypt(&encrypted, "wrong").is_err());
    }

    #[test]
    fn test_tampered_header_fails() {
        let kdf = Kdf::new_random();
        let key = derive_key("pw", &kdf).unwrap();
        let mut encrypted = encrypt(b"data", &kdf, &key).unwrap();
        encrypted[45] ^= 0xff;
        assert!(decrypt(&encrypted, "pw").is_err());
    }
}
