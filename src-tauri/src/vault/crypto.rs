use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;

use crate::error::{AppError, AppResult};

const ARGON2_MEMORY_KB: u32 = 65536;
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 4;

pub const VAULT_MAGIC: &[u8; 4] = b"NYTF";
pub const VAULT_VERSION: u8 = 0x01;

pub const HEADER_SIZE: usize = 57;

pub fn derive_key(password: &str, salt: &[u8; 16]) -> AppResult<[u8; 32]> {
    let params = Params::new(
        ARGON2_MEMORY_KB,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        Some(32),
    )
    .map_err(|e| AppError::Crypto(format!("Argon2 params error: {}", e)))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Crypto(format!("Argon2 hash error: {}", e)))?;

    Ok(key)
}

pub fn encrypt(plaintext: &[u8], password: &str) -> AppResult<Vec<u8>> {
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 24];
    let mut rng = rand::thread_rng();
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(password, &salt)?;

    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("Cipher init error: {}", e)))?;
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(format!("Encryption error: {}", e)))?;

    let mut output = Vec::with_capacity(HEADER_SIZE + ciphertext.len());

    output.extend_from_slice(VAULT_MAGIC);
    output.push(VAULT_VERSION);

    output.extend_from_slice(&salt);

    output.extend_from_slice(&nonce_bytes);

    output.extend_from_slice(&ARGON2_MEMORY_KB.to_le_bytes());
    output.extend_from_slice(&ARGON2_TIME_COST.to_le_bytes());
    output.extend_from_slice(&ARGON2_PARALLELISM.to_le_bytes());

    output.extend_from_slice(&ciphertext);

    Ok(output)
}

pub fn decrypt(data: &[u8], password: &str) -> AppResult<Vec<u8>> {
    if data.len() < HEADER_SIZE {
        return Err(AppError::Crypto("Vault file too short".into()));
    }

    if &data[0..4] != VAULT_MAGIC {
        return Err(AppError::Crypto("Invalid vault file magic".into()));
    }

    if data[4] != VAULT_VERSION {
        return Err(AppError::Crypto(format!(
            "Unsupported vault version: {}",
            data[4]
        )));
    }

    let mut salt = [0u8; 16];
    salt.copy_from_slice(&data[5..21]);

    let mut nonce_bytes = [0u8; 24];
    nonce_bytes.copy_from_slice(&data[21..45]);

    let _memory = u32::from_le_bytes(data[45..49].try_into().unwrap());
    let _time = u32::from_le_bytes(data[49..53].try_into().unwrap());
    let _parallelism = u32::from_le_bytes(data[53..57].try_into().unwrap());

    let ciphertext = &data[HEADER_SIZE..];

    let key = derive_key(password, &salt)?;

    let cipher = XChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| AppError::Crypto(format!("Cipher init error: {}", e)))?;
    let nonce = XNonce::from_slice(&nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|_| {
        AppError::Crypto("Decryption failed — wrong password or corrupted vault".into())
    })?;

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = b"Hello, Watchtower vault!";
        let password = "test-password-123";

        let encrypted = encrypt(plaintext, password).unwrap();
        let decrypted = decrypt(&encrypted, password).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_wrong_password_fails() {
        let plaintext = b"secret data";
        let encrypted = encrypt(plaintext, "correct").unwrap();
        let result = decrypt(&encrypted, "wrong");
        assert!(result.is_err());
    }
}
