use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::AppError;
use crate::vault::schema::{AuthMethod, JumpHost, Protocol, ServerEntry};
use crate::vault::store::{self, SharedVaultState};

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub added: usize,
    pub skipped: usize,
    pub names: Vec<String>,
}

fn home() -> PathBuf {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/"))
}

fn expand_tilde(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        home().join(rest).to_string_lossy().to_string()
    } else if p == "~" {
        home().to_string_lossy().to_string()
    } else {
        p.to_string()
    }
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn add_servers(
    state: &State<'_, SharedVaultState>,
    entries: Vec<ServerEntry>,
) -> Result<ImportResult, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let kdf = vault.kdf.clone();
    let key = vault.key.clone();

    let data = vault.get_data_mut()?;
    let existing: HashSet<(String, u16, String)> = data
        .servers
        .iter()
        .map(|s| (s.host.to_lowercase(), s.port, s.username.clone()))
        .collect();

    let mut added = 0;
    let mut skipped = 0;
    let mut names = Vec::new();
    for e in entries {
        let dedup = (e.host.to_lowercase(), e.port, e.username.clone());
        if existing.contains(&dedup) {
            skipped += 1;
            continue;
        }
        names.push(e.name.clone());
        added += 1;
        data.servers.push(e);
    }

    if let (Some(path), Some(kdf), Some(key)) = (file_path, kdf, key) {
        store::save_vault(&path, &kdf, &key, data)?;
    }
    Ok(ImportResult {
        added,
        skipped,
        names,
    })
}

// ---------- ~/.ssh/config ----------

#[derive(Default)]
struct SshBlock {
    hosts: Vec<String>,
    hostname: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity: Option<String>,
    proxy_jump: Option<String>,
    compression: bool,
    skip: bool,
}

fn parse_jump(token: &str) -> Option<JumpHost> {
    let token = token.trim();
    if token.is_empty() || token.eq_ignore_ascii_case("none") {
        return None;
    }
    let (user, rest) = match token.split_once('@') {
        Some((u, r)) => (u.to_string(), r),
        None => ("root".to_string(), token),
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), p.parse().unwrap_or(22))
        }
        _ => (rest.to_string(), 22),
    };
    Some(JumpHost {
        host,
        port,
        username: user,
        auth: AuthMethod::Agent,
    })
}

fn ssh_block_to_entries(b: &SshBlock) -> Vec<ServerEntry> {
    if b.skip {
        return Vec::new();
    }
    let mut out = Vec::new();
    for h in &b.hosts {
        if h.contains('*') || h.contains('?') || h == "*" {
            continue;
        }
        let host = b.hostname.clone().unwrap_or_else(|| h.clone());
        let user = b.user.clone().unwrap_or_else(|| "root".into());
        let port = b.port.unwrap_or(22);
        let auth = match &b.identity {
            Some(p) => AuthMethod::KeyFile {
                path: expand_tilde(p),
                passphrase: None,
            },
            None => AuthMethod::Agent,
        };
        let mut e = ServerEntry::new(h.clone(), host, port, user, auth, Protocol::Ssh);
        e.advanced.compression = b.compression;
        if let Some(pj) = &b.proxy_jump {
            e.advanced.jump_hosts = pj.split(',').filter_map(parse_jump).collect();
        }
        e.notes = Some("Imported from ~/.ssh/config".into());
        out.push(e);
    }
    out
}

fn parse_ssh_config(text: &str) -> Vec<ServerEntry> {
    let mut entries = Vec::new();
    let mut cur: Option<SshBlock> = None;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, val) = match line.split_once(|c: char| c.is_whitespace() || c == '=') {
            Some((k, v)) => (
                k.trim().to_lowercase(),
                v.trim().trim_matches('"').to_string(),
            ),
            None => (line.to_lowercase(), String::new()),
        };

        match key.as_str() {
            "host" => {
                if let Some(b) = cur.take() {
                    entries.extend(ssh_block_to_entries(&b));
                }
                let mut b = SshBlock::default();
                b.hosts = val.split_whitespace().map(String::from).collect();
                cur = Some(b);
            }
            "match" => {
                if let Some(b) = cur.take() {
                    entries.extend(ssh_block_to_entries(&b));
                }
                cur = Some(SshBlock {
                    skip: true,
                    ..Default::default()
                });
            }
            _ => {
                if let Some(b) = cur.as_mut() {
                    match key.as_str() {
                        "hostname" => b.hostname = Some(val),
                        "user" => b.user = Some(val),
                        "port" => b.port = val.parse().ok(),
                        "identityfile" => {
                            if b.identity.is_none() {
                                b.identity = Some(val)
                            }
                        }
                        "proxyjump" => b.proxy_jump = Some(val),
                        "compression" => b.compression = val.eq_ignore_ascii_case("yes"),
                        _ => {}
                    }
                }
            }
        }
    }
    if let Some(b) = cur {
        entries.extend(ssh_block_to_entries(&b));
    }
    entries
}

#[tauri::command]
pub async fn import_ssh_config(
    path: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<ImportResult, AppError> {
    let p = path
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".ssh").join("config"));
    let text = std::fs::read_to_string(&p)
        .map_err(|e| AppError::General(format!("Cannot read {}: {}", p.display(), e)))?;
    add_servers(&state, parse_ssh_config(&text))
}

// ---------- PuTTY ----------

fn putty_kv(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
        .collect()
}

#[tauri::command]
pub async fn import_putty(
    path: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<ImportResult, AppError> {
    let mut entries = Vec::new();

    let target = path.map(PathBuf::from);
    let is_reg = target
        .as_ref()
        .map(|p| p.extension().map(|e| e == "reg").unwrap_or(false))
        .unwrap_or(false);

    if is_reg {
        let text = std::fs::read_to_string(target.as_ref().unwrap())
            .map_err(|e| AppError::General(format!("Cannot read .reg: {}", e)))?;
        let text = text.replace('\u{feff}', "");
        let mut name = String::new();
        let mut host = String::new();
        let mut port = 22u16;
        let mut user = String::new();
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix('[') {
                if !name.is_empty() && !host.is_empty() {
                    entries.push(mk_ssh(&name, &host, port, &user));
                }
                name = rest
                    .rsplit_once("\\Sessions\\")
                    .map(|(_, n)| url_decode(n.trim_end_matches(']')))
                    .unwrap_or_default();
                host.clear();
                port = 22;
                user.clear();
            } else if let Some((k, v)) = line.split_once('=') {
                let k = k.trim().trim_matches('"');
                let v = v.trim();
                match k {
                    "HostName" => host = v.trim_matches('"').to_string(),
                    "UserName" => user = v.trim_matches('"').to_string(),
                    "PortNumber" => {
                        port = v
                            .strip_prefix("dword:")
                            .and_then(|h| u16::from_str_radix(h, 16).ok())
                            .unwrap_or(22);
                    }
                    _ => {}
                }
            }
        }
        if !name.is_empty() && !host.is_empty() {
            entries.push(mk_ssh(&name, &host, port, &user));
        }
    } else {
        let dir = target.unwrap_or_else(|| home().join(".putty").join("sessions"));
        let rd = std::fs::read_dir(&dir)
            .map_err(|e| AppError::General(format!("Cannot read {}: {}", dir.display(), e)))?;
        for entry in rd.flatten() {
            let Ok(text) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            let kv = putty_kv(&text);
            let get = |k: &str| kv.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.clone());
            let host = get("HostName").unwrap_or_default();
            if host.is_empty() {
                continue;
            }
            let name = url_decode(&entry.file_name().to_string_lossy());
            let port = get("PortNumber").and_then(|p| p.parse().ok()).unwrap_or(22);
            let user = get("UserName").unwrap_or_default();
            entries.push(mk_ssh(&name, &host, port, &user));
        }
    }

    add_servers(&state, entries)
}

// ---------- SecureCRT ----------

fn walk_ini(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk_ini(&p, out);
            } else if p.extension().map(|x| x == "ini").unwrap_or(false) {
                out.push(p);
            }
        }
    }
}

#[tauri::command]
pub async fn import_securecrt(
    path: String,
    state: State<'_, SharedVaultState>,
) -> Result<ImportResult, AppError> {
    let root = PathBuf::from(&path);
    let mut files = Vec::new();
    if root.is_dir() {
        walk_ini(&root, &mut files);
    } else {
        files.push(root);
    }

    let mut entries = Vec::new();
    for f in files {
        let Ok(text) = std::fs::read_to_string(&f) else {
            continue;
        };
        let mut host = String::new();
        let mut user = String::new();
        let mut port = 22u16;
        for line in text.lines() {
            let line = line.trim();
            let Some((decl, rest)) = line.split_once(':') else {
                continue;
            };
            let Some((keyq, val)) = rest.split_once('=') else {
                continue;
            };
            let key = keyq.trim().trim_matches('"');
            let val = val.trim();
            match key {
                "Hostname" => host = val.to_string(),
                "Username" => user = val.to_string(),
                k if k.contains("Port") => {
                    if decl.trim() == "D" {
                        port = u32::from_str_radix(val, 16).unwrap_or(22) as u16;
                    } else {
                        port = val.parse().unwrap_or(22);
                    }
                }
                _ => {}
            }
        }
        if host.is_empty() {
            continue;
        }
        let name = f
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| host.clone());
        entries.push(mk_ssh(&name, &host, port, &user));
    }

    add_servers(&state, entries)
}

fn mk_ssh(name: &str, host: &str, port: u16, user: &str) -> ServerEntry {
    let user = if user.is_empty() { "root" } else { user };
    let mut e = ServerEntry::new(
        name.to_string(),
        host.to_string(),
        port,
        user.to_string(),
        AuthMethod::Agent,
        Protocol::Ssh,
    );
    e.notes = Some("Imported".into());
    e
}

// ---------- JSON (Watchtower own format) ----------

#[derive(Serialize, Deserialize)]
pub struct JsonServer {
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_port() -> u16 {
    22
}

#[derive(Serialize, Deserialize)]
pub struct JsonExport {
    pub format: String,
    pub version: u8,
    pub servers: Vec<JsonServer>,
}

#[tauri::command]
pub async fn import_json(
    json: Option<String>,
    path: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<ImportResult, AppError> {
    let json = match (json, path) {
        (Some(j), _) => j,
        (None, Some(p)) => std::fs::read_to_string(&p)
            .map_err(|e| AppError::General(format!("Cannot read {}: {}", p, e)))?,
        _ => return Err(AppError::General("No JSON provided".into())),
    };
    let parsed: JsonExport = serde_json::from_str(&json)
        .or_else(|_| {
            serde_json::from_str::<Vec<JsonServer>>(&json).map(|servers| JsonExport {
                format: "watchtower".into(),
                version: 1,
                servers,
            })
        })
        .map_err(|e| AppError::General(format!("Invalid JSON: {}", e)))?;

    let entries = parsed
        .servers
        .into_iter()
        .map(|s| {
            let proto = match s.protocol.as_deref() {
                Some("sftp") => Protocol::Sftp,
                _ => Protocol::Ssh,
            };
            let user = if s.username.is_empty() {
                "root".into()
            } else {
                s.username
            };
            let mut e = ServerEntry::new(s.name, s.host, s.port, user, AuthMethod::Agent, proto);
            e.notes = s.notes;
            e
        })
        .collect();

    add_servers(&state, entries)
}

#[tauri::command]
pub async fn export_ssh_config(
    path: String,
    state: State<'_, SharedVaultState>,
) -> Result<usize, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;

    let mut out = String::from("# Generated by Watchtower\n\n");
    let mut n = 0;
    for s in &data.servers {
        if !matches!(s.protocol, Protocol::Ssh | Protocol::Sftp) {
            continue;
        }
        let alias = s
            .name
            .chars()
            .map(|c| if c.is_whitespace() { '-' } else { c })
            .collect::<String>();
        out.push_str(&format!("Host {}\n", alias));
        out.push_str(&format!("    HostName {}\n", s.host));
        out.push_str(&format!("    User {}\n", s.username));
        if s.port != 22 {
            out.push_str(&format!("    Port {}\n", s.port));
        }
        if let AuthMethod::KeyFile { path, .. } = &s.auth {
            out.push_str(&format!("    IdentityFile {}\n", path));
        }
        if let Some(jh) = s.advanced.jump_hosts.first() {
            let chain = s
                .advanced
                .jump_hosts
                .iter()
                .map(|j| format!("{}@{}:{}", j.username, j.host, j.port))
                .collect::<Vec<_>>()
                .join(",");
            let _ = jh;
            out.push_str(&format!("    ProxyJump {}\n", chain));
        }
        if s.advanced.compression {
            out.push_str("    Compression yes\n");
        }
        if let Some(secs) = s.advanced.keepalive_interval {
            out.push_str(&format!("    ServerAliveInterval {}\n", secs));
        }
        out.push('\n');
        n += 1;
    }

    std::fs::write(&path, out)
        .map_err(|e| AppError::General(format!("Cannot write {}: {}", path, e)))?;
    Ok(n)
}

#[tauri::command]
pub async fn export_json_to(
    path: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let json = export_json(state).await?;
    std::fs::write(&path, json)
        .map_err(|e| AppError::General(format!("Cannot write {}: {}", path, e)))
}

#[tauri::command]
pub async fn export_json(state: State<'_, SharedVaultState>) -> Result<String, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    let export = JsonExport {
        format: "watchtower".into(),
        version: 1,
        servers: data
            .servers
            .iter()
            .map(|s| JsonServer {
                name: s.name.clone(),
                host: s.host.clone(),
                port: s.port,
                username: s.username.clone(),
                protocol: Some(format!("{:?}", s.protocol).to_lowercase()),
                notes: s.notes.clone(),
                tags: s.tags.clone(),
            })
            .collect(),
    };
    serde_json::to_string_pretty(&export).map_err(|e| AppError::General(e.to_string()))
}
