use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultData {
    pub servers: Vec<ServerEntry>,
    pub groups: Vec<ServerGroup>,
    pub tags: Vec<Tag>,
    pub snippets: Vec<Snippet>,
    pub keychains: Vec<KeychainEntry>,
    pub known_hosts: Vec<KnownHost>,
    pub port_forwardings: Vec<PortForwardingRule>,
    pub settings: VaultSettings,
}

impl Default for VaultData {
    fn default() -> Self {
        Self {
            servers: Vec::new(),
            groups: Vec::new(),
            tags: Vec::new(),
            snippets: Vec::new(),
            keychains: Vec::new(),
            known_hosts: Vec::new(),
            port_forwardings: Vec::new(),
            settings: VaultSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub protocol: Protocol,
    pub group_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,

    pub advanced: AdvancedOptions,

    pub port_forwarding_ids: Vec<String>,

    pub keychain_id: Option<String>,

    pub created_at: String,
    pub updated_at: String,
}

impl ServerEntry {
    pub fn new(
        name: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        protocol: Protocol,
    ) -> Self {
        let now = timestamp_now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            host,
            port,
            username,
            auth,
            protocol,
            group_id: None,
            color: None,
            icon: None,
            notes: None,
            tags: Vec::new(),
            advanced: AdvancedOptions::default(),
            port_forwarding_ids: Vec::new(),
            keychain_id: None,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedOptions {
    pub agent_forwarding: bool,

    pub startup_command: Option<String>,

    pub jump_hosts: Vec<JumpHost>,

    pub proxy: Option<ProxyConfig>,

    pub env_vars: Vec<EnvVar>,

    pub encoding: Option<String>,

    pub use_mosh: bool,
    pub mosh_port_range: Option<String>,

    pub keepalive_interval: Option<u32>,
    pub keepalive_count_max: Option<u32>,

    pub x11_forwarding: bool,

    pub compression: bool,
}

impl Default for AdvancedOptions {
    fn default() -> Self {
        Self {
            agent_forwarding: false,
            startup_command: None,
            jump_hosts: Vec::new(),
            proxy: None,
            env_vars: Vec::new(),
            encoding: Some("UTF-8".into()),
            use_mosh: false,
            mosh_port_range: None,
            keepalive_interval: None,
            keepalive_count_max: None,
            x11_forwarding: false,
            compression: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JumpHost {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyConfig {
    pub proxy_type: ProxyType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProxyType {
    Socks4,
    Socks5,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AuthMethod {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "key")]
    Key {
        private_key: String,
        passphrase: Option<String>,
    },
    #[serde(rename = "key_file")]
    KeyFile {
        path: String,
        passphrase: Option<String>,
    },
    #[serde(rename = "keychain")]
    Keychain { keychain_id: String },
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Protocol {
    Ssh,
    Sftp,
    Ftp,
    Ftps,
    Telnet,
    Mosh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub order: i32,
}

impl ServerGroup {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            color: None,
            icon: None,
            parent_id: None,
            order: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

impl Tag {
    pub fn new(name: String, color: Option<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            color,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: String,
    pub name: String,
    pub content: String,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Snippet {
    pub fn new(name: String, content: String, description: Option<String>) -> Self {
        let now = timestamp_now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            content,
            description,
            tags: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeychainEntry {
    pub id: String,
    pub name: String,
    pub credential: CredentialType,
    pub created_at: String,
    pub updated_at: String,
}

impl KeychainEntry {
    pub fn new(name: String, credential: CredentialType) -> Self {
        let now = timestamp_now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            credential,
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CredentialType {
    #[serde(rename = "password")]
    Password { username: String, password: String },
    #[serde(rename = "ssh_key")]
    SshKey {
        private_key: String,
        public_key: Option<String>,
        passphrase: Option<String>,
        key_type: String,
        bits: Option<u32>,
    },
    #[serde(rename = "certificate")]
    Certificate {
        certificate: String,
        private_key: Option<String>,
        passphrase: Option<String>,
    },
    #[serde(rename = "fido")]
    Fido {
        credential_id: String,
        relying_party: String,
    },
    #[serde(rename = "touch_id")]
    TouchId {
        public_key: String,
        key_handle: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardingRule {
    pub id: String,
    pub name: String,
    pub rule_type: PortForwardType,
    pub local_host: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub auto_start: bool,
    pub server_id: Option<String>,
}

impl PortForwardingRule {
    pub fn new(
        name: String,
        rule_type: PortForwardType,
        local_host: String,
        local_port: u16,
        remote_host: String,
        remote_port: u16,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            rule_type,
            local_host,
            local_port,
            remote_host,
            remote_port,
            auto_start: false,
            server_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PortForwardType {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub key_fingerprint: String,
    pub key_data: Option<String>,
    pub first_seen: String,
    pub last_seen: Option<String>,
    pub trusted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionLog {
    pub timestamp: String,
    pub level: LogLevel,
    pub message: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CloudProvider {
    Aws,
    DigitalOcean,
    Azure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudImportConfig {
    pub provider: CloudProvider,
    pub credentials: CloudCredentials,
    pub region: Option<String>,
    pub filters: Option<CloudFilters>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CloudCredentials {
    #[serde(rename = "aws")]
    Aws {
        access_key_id: String,
        secret_access_key: String,
        session_token: Option<String>,
    },
    #[serde(rename = "digitalocean")]
    DigitalOcean { api_token: String },
    #[serde(rename = "azure")]
    Azure {
        tenant_id: String,
        client_id: String,
        client_secret: String,
        subscription_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudFilters {
    pub tags: Option<Vec<String>>,
    pub regions: Option<Vec<String>>,
    pub name_pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudInstance {
    pub instance_id: String,
    pub name: String,
    pub public_ip: Option<String>,
    pub private_ip: Option<String>,
    pub region: String,
    pub state: String,
    pub provider: CloudProvider,
    pub tags: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSettings {
    pub theme: String,
    pub font_size: u16,
    pub font_family: String,
    pub default_shell: Option<String>,
    pub default_encoding: String,
    pub log_connections: bool,
    pub log_retention_days: u32,
    pub confirm_on_disconnect: bool,
    pub confirm_on_delete: bool,
}

impl Default for VaultSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            font_size: 14,
            font_family: "JetBrains Mono, Menlo, Monaco, monospace".into(),
            default_shell: None,
            default_encoding: "UTF-8".into(),
            log_connections: true,
            log_retention_days: 30,
            confirm_on_disconnect: true,
            confirm_on_delete: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub protocol: String,
    pub group_id: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub advanced: AdvancedOptions,
    pub port_forwarding_ids: Vec<String>,
    pub keychain_id: Option<String>,
}

impl From<&ServerEntry> for ServerInfo {
    fn from(entry: &ServerEntry) -> Self {
        let auth_type = match &entry.auth {
            AuthMethod::Password { .. } => "password",
            AuthMethod::Key { .. } => "key",
            AuthMethod::KeyFile { .. } => "key_file",
            AuthMethod::Keychain { .. } => "keychain",
            AuthMethod::None => "none",
        };
        let protocol = match &entry.protocol {
            Protocol::Ssh => "ssh",
            Protocol::Sftp => "sftp",
            Protocol::Ftp => "ftp",
            Protocol::Ftps => "ftps",
            Protocol::Telnet => "telnet",
            Protocol::Mosh => "mosh",
        };
        Self {
            id: entry.id.clone(),
            name: entry.name.clone(),
            host: entry.host.clone(),
            port: entry.port,
            username: entry.username.clone(),
            auth_type: auth_type.into(),
            protocol: protocol.into(),
            group_id: entry.group_id.clone(),
            color: entry.color.clone(),
            icon: entry.icon.clone(),
            notes: entry.notes.clone(),
            tags: entry.tags.clone(),
            advanced: entry.advanced.clone(),
            port_forwarding_ids: entry.port_forwarding_ids.clone(),
            keychain_id: entry.keychain_id.clone(),
        }
    }
}

pub fn timestamp_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}
