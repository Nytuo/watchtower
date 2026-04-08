use rand::rngs::OsRng;
use serde::Serialize;
use ssh_key::private::{Ed25519Keypair, KeypairData, RsaKeypair};
use ssh_key::{HashAlg, LineEnding, PrivateKey};

use crate::error::AppError;

#[derive(Serialize)]
pub struct GeneratedKey {
    pub private_key: String,
    pub public_key: String,
    pub fingerprint: String,
    pub key_type: String,
    pub bits: Option<u32>,
}

#[tauri::command]
pub async fn generate_ssh_key(
    key_type: String,
    bits: Option<u32>,
    comment: Option<String>,
    passphrase: Option<String>,
) -> Result<GeneratedKey, AppError> {
    let comment = comment.unwrap_or_default();
    let mut rng = OsRng;

    let (key_data, kt, kbits): (KeypairData, &str, Option<u32>) =
        match key_type.to_lowercase().as_str() {
            "rsa" => {
                let b = bits.unwrap_or(4096).clamp(2048, 8192);
                let kp = RsaKeypair::random(&mut rng, b as usize)
                    .map_err(|e| AppError::General(format!("RSA key generation failed: {e}")))?;
                (KeypairData::from(kp), "rsa", Some(b))
            }
            _ => {
                let kp = Ed25519Keypair::random(&mut rng);
                (KeypairData::from(kp), "ed25519", None)
            }
        };

    let mut key = PrivateKey::new(key_data, comment)
        .map_err(|e| AppError::General(format!("key assembly failed: {e}")))?;

    if let Some(pw) = passphrase.as_deref().filter(|p| !p.is_empty()) {
        key = key
            .encrypt(&mut rng, pw)
            .map_err(|e| AppError::General(format!("key encryption failed: {e}")))?;
    }

    let private_key = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| AppError::General(format!("private key serialization failed: {e}")))?
        .to_string();

    let public = key.public_key();
    let public_key = public
        .to_openssh()
        .map_err(|e| AppError::General(format!("public key serialization failed: {e}")))?;
    let fingerprint = public.fingerprint(HashAlg::Sha256).to_string();

    Ok(GeneratedKey {
        private_key,
        public_key,
        fingerprint,
        key_type: kt.to_string(),
        bits: kbits,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ed25519_roundtrips_as_openssh() {
        let k = generate_ssh_key("ed25519".into(), None, Some("me@host".into()), None)
            .await
            .unwrap();
        assert!(k
            .private_key
            .starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        assert!(k.public_key.starts_with("ssh-ed25519 "));
        assert!(k.public_key.trim_end().ends_with("me@host"));
        assert!(k.fingerprint.starts_with("SHA256:"));
        // russh must be able to load what we produced.
        russh_keys::decode_secret_key(&k.private_key, None).unwrap();
    }

    #[tokio::test]
    async fn encrypted_key_requires_passphrase() {
        let k = generate_ssh_key("ed25519".into(), None, None, Some("hunter2".into()))
            .await
            .unwrap();
        assert!(russh_keys::decode_secret_key(&k.private_key, None).is_err());
        russh_keys::decode_secret_key(&k.private_key, Some("hunter2")).unwrap();
    }

    #[tokio::test]
    async fn rsa_generates_requested_size() {
        let k = generate_ssh_key("rsa".into(), Some(2048), None, None)
            .await
            .unwrap();
        assert_eq!(k.bits, Some(2048));
        assert!(k.public_key.starts_with("ssh-rsa "));
        russh_keys::decode_secret_key(&k.private_key, None).unwrap();
    }
}
