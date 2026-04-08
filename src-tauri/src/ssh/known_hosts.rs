use serde::Serialize;

use crate::vault::schema::KnownHost;

pub struct KnownHostsStore {
    pub hosts: Vec<KnownHost>,
}

impl KnownHostsStore {
    pub fn new() -> Self {
        Self { hosts: Vec::new() }
    }

    pub fn from_entries(entries: Vec<KnownHost>) -> Self {
        Self { hosts: entries }
    }

    pub fn check(&self, host: &str, port: u16, fingerprint: &str) -> HostKeyStatus {
        for known in &self.hosts {
            if known.host == host && known.port == port {
                if known.key_fingerprint == fingerprint {
                    return HostKeyStatus::Known;
                } else {
                    return HostKeyStatus::Changed {
                        old_fingerprint: known.key_fingerprint.clone(),
                    };
                }
            }
        }
        HostKeyStatus::Unknown
    }

    pub fn add(&mut self, host: String, port: u16, key_type: String, key_fingerprint: String) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        self.hosts.push(KnownHost {
            host,
            port,
            key_type,
            key_fingerprint,
            key_data: None,
            first_seen: format!("{}", secs),
            last_seen: None,
            trusted: true,
        });
    }
}

#[derive(Debug, Serialize)]
pub enum HostKeyStatus {
    Known,
    Unknown,
    Changed { old_fingerprint: String },
}
