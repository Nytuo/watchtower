use std::path::PathBuf;
use tauri::State;

use crate::error::AppError;
use crate::vault::schema::*;
use crate::vault::store::{self, SharedVaultState};

#[tauri::command]
pub async fn vault_create(
    password: String,
    path: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let vault_path = path
        .map(PathBuf::from)
        .unwrap_or_else(store::default_vault_path);

    let data = store::create_vault(&vault_path, &password)?;

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    vault.data = Some(data);
    vault.file_path = Some(vault_path);
    vault.password = Some(password);

    Ok(())
}

#[tauri::command]
pub async fn vault_open(
    password: String,
    path: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let vault_path = path
        .map(PathBuf::from)
        .unwrap_or_else(store::default_vault_path);

    let data = store::open_vault(&vault_path, &password)?;

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    vault.data = Some(data);
    vault.file_path = Some(vault_path);
    vault.password = Some(password);

    Ok(())
}

#[tauri::command]
pub async fn vault_lock(state: State<'_, SharedVaultState>) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    vault.data = None;
    vault.password = None;
    Ok(())
}

#[tauri::command]
pub async fn vault_is_unlocked(state: State<'_, SharedVaultState>) -> Result<bool, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    Ok(vault.is_unlocked())
}

#[tauri::command]
pub async fn vault_exists(path: Option<String>) -> Result<bool, AppError> {
    let vault_path = path
        .map(PathBuf::from)
        .unwrap_or_else(store::default_vault_path);
    Ok(vault_path.exists())
}

#[tauri::command]
pub async fn vault_change_password(
    current_password: String,
    new_password: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;

    let stored_pw = vault
        .password
        .as_ref()
        .ok_or_else(|| AppError::Vault("Vault is locked".into()))?;
    if *stored_pw != current_password {
        return Err(AppError::Vault("Current password is incorrect".into()));
    }

    let file_path = vault.file_path.clone();
    let data = vault.get_data()?;

    if let Some(path) = file_path {
        store::save_vault(&path, &new_password, data)?;
    }

    vault.password = Some(new_password);
    Ok(())
}

fn parse_auth(
    auth_type: &str,
    password: Option<String>,
    private_key: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
    keychain_id: Option<String>,
) -> Result<AuthMethod, AppError> {
    match auth_type {
        "password" => Ok(AuthMethod::Password {
            password: password.ok_or_else(|| AppError::Vault("Password required".into()))?,
        }),
        "key" => Ok(AuthMethod::Key {
            private_key: private_key
                .ok_or_else(|| AppError::Vault("Private key required".into()))?,
            passphrase,
        }),
        "key_file" => Ok(AuthMethod::KeyFile {
            path: key_path.ok_or_else(|| AppError::Vault("Key file path required".into()))?,
            passphrase,
        }),
        "keychain" => Ok(AuthMethod::Keychain {
            keychain_id: keychain_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| AppError::Vault("Keychain ID required".into()))?,
        }),
        "none" => Ok(AuthMethod::None),
        _ => Err(AppError::Vault(format!("Unknown auth type: {}", auth_type))),
    }
}

fn parse_protocol(proto: &str) -> Result<Protocol, AppError> {
    match proto {
        "ssh" => Ok(Protocol::Ssh),
        "sftp" => Ok(Protocol::Sftp),
        "ftp" => Ok(Protocol::Ftp),
        "ftps" => Ok(Protocol::Ftps),
        "telnet" => Ok(Protocol::Telnet),
        "mosh" => Ok(Protocol::Mosh),
        p => Err(AppError::Vault(format!("Unknown protocol: {}", p))),
    }
}

#[tauri::command]
pub async fn vault_list_servers(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<ServerInfo>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.servers.iter().map(ServerInfo::from).collect())
}

#[tauri::command]
pub async fn vault_get_server(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<ServerInfo, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    let server = data
        .servers
        .iter()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", id)))?;
    Ok(ServerInfo::from(server))
}

#[tauri::command]
pub async fn vault_add_server(
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    private_key: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
    keychain_id: Option<String>,
    protocol: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    notes: Option<String>,
    group_id: Option<String>,
    tags: Option<Vec<String>>,
    advanced: Option<AdvancedOptions>,
    port_forwarding_ids: Option<Vec<String>>,
    state: State<'_, SharedVaultState>,
) -> Result<ServerInfo, AppError> {
    let auth = parse_auth(
        &auth_type,
        password,
        private_key,
        key_path,
        passphrase,
        keychain_id.clone(),
    )?;
    let proto = parse_protocol(protocol.as_deref().unwrap_or("ssh"))?;

    let mut entry = ServerEntry::new(name, host, port, username, auth, proto);
    entry.color = color;
    entry.icon = icon;
    entry.notes = notes;
    entry.group_id = group_id;
    entry.tags = tags.unwrap_or_default();
    entry.keychain_id = keychain_id;
    if let Some(adv) = advanced {
        entry.advanced = adv;
    }
    entry.port_forwarding_ids = port_forwarding_ids.unwrap_or_default();

    let info = ServerInfo::from(&entry);

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.servers.push(entry);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(info)
}

#[tauri::command]
pub async fn vault_update_server(
    id: String,
    name: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    auth_type: Option<String>,
    password: Option<String>,
    private_key: Option<String>,
    key_path: Option<String>,
    passphrase: Option<String>,
    keychain_id: Option<String>,
    protocol: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    notes: Option<String>,
    group_id: Option<String>,
    tags: Option<Vec<String>>,
    advanced: Option<AdvancedOptions>,
    port_forwarding_ids: Option<Vec<String>>,
    state: State<'_, SharedVaultState>,
) -> Result<ServerInfo, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let server = data
        .servers
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::Vault(format!("Server '{}' not found", id)))?;

    if let Some(n) = name {
        server.name = n;
    }
    if let Some(h) = host {
        server.host = h;
    }
    if let Some(p) = port {
        server.port = p;
    }
    if let Some(u) = username {
        server.username = u;
    }
    if let Some(at) = auth_type {
        server.auth = parse_auth(
            &at,
            password,
            private_key,
            key_path,
            passphrase,
            keychain_id.clone(),
        )?;
    }
    if let Some(p) = protocol {
        server.protocol = parse_protocol(&p)?;
    }
    if let Some(c) = color {
        server.color = Some(c);
    }
    if let Some(i) = icon {
        server.icon = Some(i);
    }
    if let Some(n) = notes {
        server.notes = Some(n);
    }
    if let Some(g) = group_id {
        server.group_id = Some(g);
    }
    if let Some(t) = tags {
        server.tags = t;
    }
    if let Some(adv) = advanced {
        server.advanced = adv;
    }
    if let Some(pf) = port_forwarding_ids {
        server.port_forwarding_ids = pf;
    }
    if let Some(kid) = keychain_id {
        server.keychain_id = Some(kid);
    }
    server.updated_at = timestamp_now();

    let info = ServerInfo::from(&*server);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(info)
}

#[tauri::command]
pub async fn vault_delete_server(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.servers.len();
    data.servers.retain(|s| s.id != id);
    if data.servers.len() == initial_len {
        return Err(AppError::Vault(format!("Server '{}' not found", id)));
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn vault_list_groups(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<ServerGroup>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.groups.clone())
}

#[tauri::command]
pub async fn vault_add_group(
    name: String,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<String>,
    order: Option<i32>,
    state: State<'_, SharedVaultState>,
) -> Result<ServerGroup, AppError> {
    let mut group = ServerGroup::new(name);
    group.color = color;
    group.icon = icon;
    group.parent_id = parent_id;
    group.order = order.unwrap_or(0);

    let result = group.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.groups.push(group);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_update_group(
    id: String,
    name: Option<String>,
    color: Option<String>,
    icon: Option<String>,
    parent_id: Option<String>,
    order: Option<i32>,
    state: State<'_, SharedVaultState>,
) -> Result<ServerGroup, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let group = data
        .groups
        .iter_mut()
        .find(|g| g.id == id)
        .ok_or_else(|| AppError::Vault(format!("Group '{}' not found", id)))?;

    if let Some(n) = name {
        group.name = n;
    }
    if let Some(c) = color {
        group.color = Some(c);
    }
    if let Some(i) = icon {
        group.icon = Some(i);
    }
    if let Some(p) = parent_id {
        group.parent_id = Some(p);
    }
    if let Some(o) = order {
        group.order = o;
    }

    let result = group.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_group(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.groups.len();
    data.groups.retain(|g| g.id != id);
    if data.groups.len() == initial_len {
        return Err(AppError::Vault(format!("Group '{}' not found", id)));
    }

    for server in &mut data.servers {
        if server.group_id.as_deref() == Some(&id) {
            server.group_id = None;
        }
    }

    for group in &mut data.groups {
        if group.parent_id.as_deref() == Some(&id) {
            group.parent_id = None;
        }
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_list_tags(state: State<'_, SharedVaultState>) -> Result<Vec<Tag>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.tags.clone())
}

#[tauri::command]
pub async fn vault_add_tag(
    name: String,
    color: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<Tag, AppError> {
    let tag = Tag::new(name, color);
    let result = tag.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.tags.push(tag);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_update_tag(
    id: String,
    name: Option<String>,
    color: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<Tag, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let tag = data
        .tags
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::Vault(format!("Tag '{}' not found", id)))?;

    if let Some(n) = name {
        tag.name = n;
    }
    if let Some(c) = color {
        tag.color = Some(c);
    }

    let result = tag.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_tag(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.tags.len();
    data.tags.retain(|t| t.id != id);
    if data.tags.len() == initial_len {
        return Err(AppError::Vault(format!("Tag '{}' not found", id)));
    }

    for server in &mut data.servers {
        server.tags.retain(|t| t != &id);
    }

    for snippet in &mut data.snippets {
        snippet.tags.retain(|t| t != &id);
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_list_snippets(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<Snippet>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.snippets.clone())
}

#[tauri::command]
pub async fn vault_add_snippet(
    name: String,
    content: String,
    description: Option<String>,
    tags: Option<Vec<String>>,
    state: State<'_, SharedVaultState>,
) -> Result<Snippet, AppError> {
    let mut snippet = Snippet::new(name, content, description);
    snippet.tags = tags.unwrap_or_default();

    let result = snippet.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.snippets.push(snippet);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_update_snippet(
    id: String,
    name: Option<String>,
    content: Option<String>,
    description: Option<String>,
    tags: Option<Vec<String>>,
    state: State<'_, SharedVaultState>,
) -> Result<Snippet, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let snippet = data
        .snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::Vault(format!("Snippet '{}' not found", id)))?;

    if let Some(n) = name {
        snippet.name = n;
    }
    if let Some(c) = content {
        snippet.content = c;
    }
    if let Some(d) = description {
        snippet.description = Some(d);
    }
    if let Some(t) = tags {
        snippet.tags = t;
    }
    snippet.updated_at = timestamp_now();

    let result = snippet.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_snippet(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.snippets.len();
    data.snippets.retain(|s| s.id != id);
    if data.snippets.len() == initial_len {
        return Err(AppError::Vault(format!("Snippet '{}' not found", id)));
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_list_keychains(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<KeychainEntry>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.keychains.clone())
}

#[tauri::command]
pub async fn vault_add_keychain(
    name: String,
    credential: CredentialType,
    state: State<'_, SharedVaultState>,
) -> Result<KeychainEntry, AppError> {
    let entry = KeychainEntry::new(name, credential);
    let result = entry.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.keychains.push(entry);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_update_keychain(
    id: String,
    name: Option<String>,
    credential: Option<CredentialType>,
    state: State<'_, SharedVaultState>,
) -> Result<KeychainEntry, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let entry = data
        .keychains
        .iter_mut()
        .find(|k| k.id == id)
        .ok_or_else(|| AppError::Vault(format!("Keychain '{}' not found", id)))?;

    if let Some(n) = name {
        entry.name = n;
    }
    if let Some(c) = credential {
        entry.credential = c;
    }
    entry.updated_at = timestamp_now();

    let result = entry.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_keychain(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.keychains.len();
    data.keychains.retain(|k| k.id != id);
    if data.keychains.len() == initial_len {
        return Err(AppError::Vault(format!("Keychain '{}' not found", id)));
    }

    for server in &mut data.servers {
        if server.keychain_id.as_deref() == Some(&id) {
            server.keychain_id = None;
        }
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_list_port_forwardings(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<PortForwardingRule>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.port_forwardings.clone())
}

#[tauri::command]
pub async fn vault_add_port_forwarding(
    name: String,
    rule_type: PortForwardType,
    local_host: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    auto_start: Option<bool>,
    server_id: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<PortForwardingRule, AppError> {
    let mut rule = PortForwardingRule::new(
        name,
        rule_type,
        local_host,
        local_port,
        remote_host,
        remote_port,
    );
    rule.auto_start = auto_start.unwrap_or(false);
    rule.server_id = server_id.clone();

    let result = rule.clone();
    let rule_id = rule.id.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.port_forwardings.push(rule);

    if let Some(sid) = server_id {
        if let Some(server) = data.servers.iter_mut().find(|s| s.id == sid) {
            if !server.port_forwarding_ids.contains(&rule_id) {
                server.port_forwarding_ids.push(rule_id);
            }
        }
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_update_port_forwarding(
    id: String,
    name: Option<String>,
    rule_type: Option<PortForwardType>,
    local_host: Option<String>,
    local_port: Option<u16>,
    remote_host: Option<String>,
    remote_port: Option<u16>,
    auto_start: Option<bool>,
    server_id: Option<String>,
    state: State<'_, SharedVaultState>,
) -> Result<PortForwardingRule, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let rule = data
        .port_forwardings
        .iter_mut()
        .find(|r| r.id == id)
        .ok_or_else(|| AppError::Vault(format!("Port forwarding rule '{}' not found", id)))?;

    if let Some(n) = name {
        rule.name = n;
    }
    if let Some(rt) = rule_type {
        rule.rule_type = rt;
    }
    if let Some(lh) = local_host {
        rule.local_host = lh;
    }
    if let Some(lp) = local_port {
        rule.local_port = lp;
    }
    if let Some(rh) = remote_host {
        rule.remote_host = rh;
    }
    if let Some(rp) = remote_port {
        rule.remote_port = rp;
    }
    if let Some(a) = auto_start {
        rule.auto_start = a;
    }
    if let Some(s) = server_id {
        rule.server_id = Some(s);
    }

    let result = rule.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_port_forwarding(
    id: String,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.port_forwardings.len();
    data.port_forwardings.retain(|r| r.id != id);
    if data.port_forwardings.len() == initial_len {
        return Err(AppError::Vault(format!(
            "Port forwarding rule '{}' not found",
            id
        )));
    }

    for server in &mut data.servers {
        server.port_forwarding_ids.retain(|pid| pid != &id);
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_list_known_hosts(
    state: State<'_, SharedVaultState>,
) -> Result<Vec<KnownHost>, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.known_hosts.clone())
}

#[tauri::command]
pub async fn vault_add_known_host(
    host: String,
    port: u16,
    key_type: String,
    key_fingerprint: String,
    key_data: Option<String>,
    trusted: Option<bool>,
    state: State<'_, SharedVaultState>,
) -> Result<KnownHost, AppError> {
    let now = timestamp_now();
    let entry = KnownHost {
        host,
        port,
        key_type,
        key_fingerprint,
        key_data,
        first_seen: now,
        last_seen: None,
        trusted: trusted.unwrap_or(true),
    };

    let result = entry.clone();

    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    data.known_hosts.push(entry);

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}

#[tauri::command]
pub async fn vault_delete_known_host(
    host: String,
    port: u16,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let initial_len = data.known_hosts.len();
    data.known_hosts
        .retain(|kh| !(kh.host == host && kh.port == port));
    if data.known_hosts.len() == initial_len {
        return Err(AppError::Vault(format!(
            "Known host '{}:{}' not found",
            host, port
        )));
    }

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_trust_known_host(
    host: String,
    port: u16,
    trusted: bool,
    state: State<'_, SharedVaultState>,
) -> Result<(), AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let entry = data
        .known_hosts
        .iter_mut()
        .find(|kh| kh.host == host && kh.port == port)
        .ok_or_else(|| AppError::Vault(format!("Known host '{}:{}' not found", host, port)))?;

    entry.trusted = trusted;
    entry.last_seen = Some(timestamp_now());

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn vault_get_settings(
    state: State<'_, SharedVaultState>,
) -> Result<VaultSettings, AppError> {
    let vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let data = vault.get_data()?;
    Ok(data.settings.clone())
}

#[tauri::command]
pub async fn vault_update_settings(
    theme: Option<String>,
    font_size: Option<u16>,
    font_family: Option<String>,
    default_shell: Option<String>,
    default_encoding: Option<String>,
    log_connections: Option<bool>,
    log_retention_days: Option<u32>,
    confirm_on_disconnect: Option<bool>,
    confirm_on_delete: Option<bool>,
    state: State<'_, SharedVaultState>,
) -> Result<VaultSettings, AppError> {
    let mut vault = state
        .lock()
        .map_err(|_| AppError::Vault("Lock poisoned".into()))?;
    let file_path = vault.file_path.clone();
    let pw = vault.password.clone();

    let data = vault.get_data_mut()?;
    let s = &mut data.settings;

    if let Some(v) = theme {
        s.theme = v;
    }
    if let Some(v) = font_size {
        s.font_size = v;
    }
    if let Some(v) = font_family {
        s.font_family = v;
    }
    if let Some(v) = default_shell {
        s.default_shell = Some(v);
    }
    if let Some(v) = default_encoding {
        s.default_encoding = v;
    }
    if let Some(v) = log_connections {
        s.log_connections = v;
    }
    if let Some(v) = log_retention_days {
        s.log_retention_days = v;
    }
    if let Some(v) = confirm_on_disconnect {
        s.confirm_on_disconnect = v;
    }
    if let Some(v) = confirm_on_delete {
        s.confirm_on_delete = v;
    }

    let result = s.clone();

    if let (Some(path), Some(pw)) = (file_path, pw) {
        store::save_vault(&path, &pw, data)?;
    }

    Ok(result)
}
