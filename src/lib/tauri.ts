import { invoke, Channel } from "@tauri-apps/api/core";

export { invoke, Channel };

export interface AdvancedOptions {
  agent_forwarding: boolean;
  startup_command: string | null;
  jump_hosts: JumpHost[];
  proxy: ProxyConfig | null;
  env_vars: EnvVar[];
  encoding: string | null;
  use_mosh: boolean;
  mosh_port_range: string | null;
  keepalive_interval: number | null;
  keepalive_count_max: number | null;
  x11_forwarding: boolean;
  compression: boolean;
  transport?: Transport;
  triggers?: Trigger[];
}

export type Transport =
  | { type: "direct" }
  | { type: "websocket"; url: string; host_header?: string | null }
  | { type: "command"; command: string };

export interface Trigger {
  pattern: string;
  send: string;
  once: boolean;
}

export interface JumpHost {
  host: string;
  port: number;
  username: string;
  auth: AuthMethod;
}

export interface ProxyConfig {
  proxy_type: "socks4" | "socks5" | "http";
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export interface EnvVar {
  key: string;
  value: string;
}

export type AuthMethod =
  | { type: "password"; password: string }
  | { type: "key"; private_key: string; passphrase?: string }
  | { type: "key_file"; path: string; passphrase?: string }
  | { type: "keychain"; keychain_id: string }
  | { type: "agent" }
  | { type: "none" };

export type Protocol = "ssh" | "sftp" | "ftp" | "ftps" | "telnet" | "mosh";

export interface ServerInfo {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: string;
  protocol: string;
  group_id: string | null;
  color: string | null;
  icon: string | null;
  notes: string | null;
  tags: string[];
  advanced: AdvancedOptions;
  port_forwarding_ids: string[];
  keychain_id: string | null;
  pinned: boolean;
  order: number;
  last_connected: string | null;
}

export interface ServerGroup {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parent_id: string | null;
  order: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export type SnippetRunMode = "paste" | "run";

export interface Snippet {
  id: string;
  name: string;
  content: string;
  description: string | null;
  tags: string[];
  pinned: boolean;
  run_mode: SnippetRunMode;
  confirm_before_run: boolean;
  shell: string | null;
  os: string | null;
  order: number;
  usage_count: number;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

export interface KeychainEntry {
  id: string;
  name: string;
  credential: CredentialType;
  created_at: string;
  updated_at: string;
}

export type CredentialType =
  | { type: "password"; username: string; password: string }
  | {
      type: "ssh_key";
      private_key: string;
      public_key?: string;
      passphrase?: string;
      key_type: string;
      bits?: number;
    }
  | {
      type: "certificate";
      certificate: string;
      private_key?: string;
      passphrase?: string;
    }
  | { type: "fido"; credential_id: string; relying_party: string }
  | { type: "touch_id"; public_key: string; key_handle: string };

export interface PortForwardingRule {
  id: string;
  name: string;
  rule_type: "local" | "remote" | "dynamic";
  local_host: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  auto_start: boolean;
  server_id: string | null;
}

export interface KnownHost {
  host: string;
  port: number;
  key_type: string;
  key_fingerprint: string;
  key_data: string | null;
  first_seen: string;
  last_seen: string | null;
  trusted: boolean;
}

export interface ConnectionLog {
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  detail: string | null;
}

export interface VaultSettings {
  theme: string;
  font_size: number;
  font_family: string;
  default_shell: string | null;
  default_encoding: string;
  log_connections: boolean;
  log_retention_days: number;
  confirm_on_disconnect: boolean;
  confirm_on_delete: boolean;
  host_key_policy: string;
  auto_lock_minutes: number;
  auto_reconnect: boolean;
  sync_mode: string;
  sync_url: string | null;
  sync_username: string | null;
  sync_password: string | null;
  sync_auto: boolean;
}

export interface AddServerParams {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
  keychainId?: string;
  protocol?: string;
  color?: string;
  icon?: string;
  notes?: string;
  groupId?: string;
  tags?: string[];
  advanced?: AdvancedOptions;
  portForwardingIds?: string[];
}

export interface UpdateServerParams {
  id: string;
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: string;
  password?: string;
  privateKey?: string;
  keyPath?: string;
  passphrase?: string;
  keychainId?: string;
  protocol?: string;
  color?: string;
  icon?: string;
  notes?: string;
  groupId?: string;
  tags?: string[];
  advanced?: AdvancedOptions;
  portForwardingIds?: string[];
  pinned?: boolean;
  order?: number;
}

export const vaultCreate = (password: string, path?: string) =>
  invoke("vault_create", { password, path });

export const vaultOpen = (password: string, path?: string) =>
  invoke("vault_open", { password, path });

export const vaultLock = () => invoke("vault_lock");

export const vaultIsUnlocked = () => invoke<boolean>("vault_is_unlocked");

export const vaultExists = (path?: string) =>
  invoke<boolean>("vault_exists", { path });

export const vaultDefaultPath = () => invoke<string>("vault_default_path");

export const vaultReopen = (password: string) =>
  invoke("vault_reopen", { password });

export const vaultAdoptIncoming = (password: string) =>
  invoke("vault_adopt_incoming", { password });

export const vaultDiscardIncoming = () => invoke("vault_discard_incoming");

export interface ImportResult {
  added: number;
  skipped: number;
  names: string[];
}

export const importSshConfig = (path?: string) =>
  invoke<ImportResult>("import_ssh_config", { path });

export const importPutty = (path?: string) =>
  invoke<ImportResult>("import_putty", { path });

export const importSecurecrt = (path: string) =>
  invoke<ImportResult>("import_securecrt", { path });

export const importJsonFile = (path: string) =>
  invoke<ImportResult>("import_json", { path });

export const exportJson = () => invoke<string>("export_json");
export const exportJsonTo = (path: string) =>
  invoke("export_json_to", { path });

export interface SyncStatus {
  configured: boolean;
  remote_exists: boolean;
  in_sync: boolean;
  local_hash: string;
  remote_hash: string | null;
}

export const syncStatus = () => invoke<SyncStatus>("sync_status");
export const syncPush = () => invoke("sync_push");
export const syncPull = () => invoke<{ pending: boolean }>("sync_pull");

export interface CloudHost {
  id: string;
  name: string;
  public_ip: string | null;
  private_ip: string | null;
  region: string;
  status: string;
}

export const cloudListDigitalocean = (token: string) =>
  invoke<CloudHost[]>("cloud_list_digitalocean", { token });

export const cloudImportHosts = (params: {
  hosts: CloudHost[];
  username: string;
  usePrivateIp: boolean;
  groupName?: string;
}) =>
  invoke<{ added: number; skipped: number }>("cloud_import_hosts", {
    ...params,
  });

export const vaultCurrentPath = () =>
  invoke<string | null>("vault_current_path");

export const biometricAvailable = (vaultPath: string) =>
  invoke<boolean>("biometric_available", { vaultPath });

export const biometricHas = (vaultPath: string) =>
  invoke<boolean>("biometric_has", { vaultPath });

export const biometricStore = (vaultPath: string, password: string) =>
  invoke("biometric_store", { vaultPath, password });

export const biometricRetrieve = (vaultPath: string) =>
  invoke<string | null>("biometric_retrieve", { vaultPath });

export const biometricClear = (vaultPath: string) =>
  invoke("biometric_clear", { vaultPath });

export const vaultChangePassword = (
  currentPassword: string,
  newPassword: string,
) => invoke("vault_change_password", { currentPassword, newPassword });

export const vaultListServers = () =>
  invoke<ServerInfo[]>("vault_list_servers");

export const vaultGetServer = (id: string) =>
  invoke<ServerInfo>("vault_get_server", { id });

export const vaultAddServer = (params: AddServerParams) =>
  invoke<ServerInfo>("vault_add_server", { ...params });

export const vaultUpdateServer = (params: UpdateServerParams) =>
  invoke<ServerInfo>("vault_update_server", { ...params });

export const vaultDeleteServer = (id: string) =>
  invoke("vault_delete_server", { id });

export const vaultMarkConnected = (id: string) =>
  invoke("vault_mark_connected", { id });

export const vaultDuplicateServer = (id: string) =>
  invoke<ServerInfo>("vault_duplicate_server", { id });

export const vaultBulkUpdateServers = (params: {
  ids: string[];
  groupId?: string;
  addTags?: string[];
  removeTags?: string[];
  delete?: boolean;
}) => invoke("vault_bulk_update_servers", { ...params });

export const vaultReorderServers = (orderedIds: string[]) =>
  invoke("vault_reorder_servers", { orderedIds });

export const vaultListGroups = () => invoke<ServerGroup[]>("vault_list_groups");

export const vaultAddGroup = (params: {
  name: string;
  color?: string;
  icon?: string;
  parentId?: string;
  order?: number;
}) => invoke<ServerGroup>("vault_add_group", { ...params });

export const vaultUpdateGroup = (params: {
  id: string;
  name?: string;
  color?: string;
  icon?: string;
  parentId?: string;
  order?: number;
}) => invoke<ServerGroup>("vault_update_group", { ...params });

export const vaultDeleteGroup = (id: string) =>
  invoke("vault_delete_group", { id });

export const vaultListTags = () => invoke<Tag[]>("vault_list_tags");

export const vaultAddTag = (name: string, color?: string) =>
  invoke<Tag>("vault_add_tag", { name, color });

export const vaultUpdateTag = (id: string, name?: string, color?: string) =>
  invoke<Tag>("vault_update_tag", { id, name, color });

export const vaultDeleteTag = (id: string) =>
  invoke("vault_delete_tag", { id });

export const vaultListSnippets = () => invoke<Snippet[]>("vault_list_snippets");

export const vaultAddSnippet = (params: {
  name: string;
  content: string;
  description?: string;
  tags?: string[];
  pinned?: boolean;
  runMode?: SnippetRunMode;
  confirmBeforeRun?: boolean;
  shell?: string;
  os?: string;
}) => invoke<Snippet>("vault_add_snippet", { ...params });

export const vaultUpdateSnippet = (params: {
  id: string;
  name?: string;
  content?: string;
  description?: string;
  tags?: string[];
  pinned?: boolean;
  runMode?: SnippetRunMode;
  confirmBeforeRun?: boolean;
  shell?: string;
  os?: string;
}) => invoke<Snippet>("vault_update_snippet", { ...params });

export const vaultDeleteSnippet = (id: string) =>
  invoke("vault_delete_snippet", { id });

export const vaultTouchSnippet = (id: string) =>
  invoke("vault_touch_snippet", { id });

export const vaultListKeychains = () =>
  invoke<KeychainEntry[]>("vault_list_keychains");

export const vaultAddKeychain = (name: string, credential: CredentialType) =>
  invoke<KeychainEntry>("vault_add_keychain", { name, credential });

export const vaultUpdateKeychain = (
  id: string,
  name?: string,
  credential?: CredentialType,
) => invoke<KeychainEntry>("vault_update_keychain", { id, name, credential });

export const vaultDeleteKeychain = (id: string) =>
  invoke("vault_delete_keychain", { id });

export const vaultListPortForwardings = () =>
  invoke<PortForwardingRule[]>("vault_list_port_forwardings");

export const vaultAddPortForwarding = (params: {
  name: string;
  ruleType: "local" | "remote" | "dynamic";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  autoStart?: boolean;
  serverId?: string;
}) => invoke<PortForwardingRule>("vault_add_port_forwarding", { ...params });

export const vaultUpdatePortForwarding = (params: {
  id: string;
  name?: string;
  ruleType?: "local" | "remote" | "dynamic";
  localHost?: string;
  localPort?: number;
  remoteHost?: string;
  remotePort?: number;
  autoStart?: boolean;
  serverId?: string;
}) => invoke<PortForwardingRule>("vault_update_port_forwarding", { ...params });

export const vaultDeletePortForwarding = (id: string) =>
  invoke("vault_delete_port_forwarding", { id });

export const vaultListKnownHosts = () =>
  invoke<KnownHost[]>("vault_list_known_hosts");

export const vaultAddKnownHost = (params: {
  host: string;
  port: number;
  keyType: string;
  keyFingerprint: string;
  keyData?: string;
  trusted?: boolean;
}) => invoke<KnownHost>("vault_add_known_host", { ...params });

export const vaultDeleteKnownHost = (host: string, port: number) =>
  invoke("vault_delete_known_host", { host, port });

export const vaultTrustKnownHost = (
  host: string,
  port: number,
  trusted: boolean,
) => invoke("vault_trust_known_host", { host, port, trusted });

export const vaultGetSettings = () =>
  invoke<VaultSettings>("vault_get_settings");

export const vaultUpdateSettings = (params: {
  theme?: string;
  fontSize?: number;
  fontFamily?: string;
  defaultShell?: string;
  defaultEncoding?: string;
  logConnections?: boolean;
  logRetentionDays?: number;
  confirmOnDisconnect?: boolean;
  confirmOnDelete?: boolean;
  hostKeyPolicy?: string;
  autoLockMinutes?: number;
  autoReconnect?: boolean;
  syncMode?: string;
  syncUrl?: string;
  syncUsername?: string;
  syncPassword?: string;
  syncAuto?: boolean;
}) => invoke<VaultSettings>("vault_update_settings", { ...params });

export interface KbdPrompt {
  name: string;
  instructions: string;
  prompts: { prompt: string; echo: boolean }[];
}

export const sshConnect = (
  serverId: string,
  clientId: string,
  cols: number,
  rows: number,
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
  onKbd: Channel<KbdPrompt>,
) =>
  invoke<string>("ssh_connect", {
    serverId,
    clientId,
    cols,
    rows,
    onData,
    onLog,
    onKbd,
  });

export const sshSubmitKbd = (clientId: string, answers: string[] | null) =>
  invoke("ssh_submit_kbd", { clientId, answers });

export interface TestResult {
  ok: boolean;
  latency_ms: number;
  error: string | null;
}
export const sshTestConnection = (serverId: string) =>
  invoke<TestResult>("ssh_test_connection", { serverId });

export const sshStartLog = (sessionId: string, path: string) =>
  invoke("ssh_start_log", { sessionId, path });
export const sshStopLog = (sessionId: string) =>
  invoke("ssh_stop_log", { sessionId });

export const exportSshConfig = (path: string) =>
  invoke<number>("export_ssh_config", { path });

export interface GeneratedKey {
  private_key: string;
  public_key: string;
  fingerprint: string;
  key_type: string;
  bits: number | null;
}
export const generateSshKey = (params: {
  keyType: "ed25519" | "rsa";
  bits?: number;
  comment?: string;
  passphrase?: string;
}) => invoke<GeneratedKey>("generate_ssh_key", { ...params });

// ── Telnet / Mosh / PTY terminal sessions ──────────────────────
export const telnetConnect = (
  host: string,
  port: number,
  cols: number,
  rows: number,
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
) => invoke<string>("telnet_connect", { host, port, cols, rows, onData, onLog });

export const moshConnect = (
  serverId: string,
  cols: number,
  rows: number,
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
) => invoke<string>("mosh_connect", { serverId, cols, rows, onData, onLog });

export const ptyConnect = (
  argv: string[],
  cwd: string | null,
  cols: number,
  rows: number,
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
) => invoke<string>("pty_connect", { argv, cwd, cols, rows, onData, onLog });

export const termWrite = (sessionId: string, data: number[]) =>
  invoke("term_write", { sessionId, data });
export const termResize = (sessionId: string, cols: number, rows: number) =>
  invoke("term_resize", { sessionId, cols, rows });
export const termClose = (sessionId: string) =>
  invoke("term_close", { sessionId });
export const termStartLog = (sessionId: string, path: string) =>
  invoke("term_start_log", { sessionId, path });
export const termStopLog = (sessionId: string) =>
  invoke("term_stop_log", { sessionId });

// ── FTP / FTPS ────────────────────────────────────────────────
export interface FtpEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
}
export const ftpConnect = (params: {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}) => invoke<string>("ftp_connect", { ...params });
export const ftpConnectServer = (serverId: string, secure?: boolean) =>
  invoke<string>("ftp_connect_server", { serverId, secure });
export const ftpDisconnect = (id: string) => invoke("ftp_disconnect", { id });
export const ftpList = (id: string, path: string) =>
  invoke<FtpEntry[]>("ftp_list", { id, path });
export const ftpMkdir = (id: string, path: string) =>
  invoke("ftp_mkdir", { id, path });
export const ftpDelete = (id: string, path: string, isDir: boolean) =>
  invoke("ftp_delete", { id, path, isDir });
export const ftpRename = (id: string, from: string, to: string) =>
  invoke("ftp_rename", { id, from, to });
export const ftpDownload = (id: string, remote: string, local: string) =>
  invoke("ftp_download", { id, remote, local });
export const ftpUpload = (id: string, local: string, remote: string) =>
  invoke("ftp_upload", { id, local, remote });

// ── Cloud import (AWS / Azure) ────────────────────────────────
export const cloudListAws = (params: {
  accessKey: string;
  secretKey: string;
  region: string;
  sessionToken?: string;
}) => invoke<CloudHost[]>("cloud_list_aws", { ...params });

export const cloudListAzure = (params: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
}) => invoke<CloudHost[]>("cloud_list_azure", { ...params });

export const sshConnectAdhoc = (
  params: {
    host: string;
    port: number;
    username: string;
    authType: string;
    password?: string;
    keyPath?: string;
    passphrase?: string;
    cols: number;
    rows: number;
  },
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
) => invoke<string>("ssh_connect_adhoc", { ...params, onData, onLog });

export const sshSendStartupCommand = (sessionId: string, serverId: string) =>
  invoke("ssh_send_startup_command", { sessionId, serverId });

export const sshWrite = (sessionId: string, data: number[]) =>
  invoke("ssh_write", { sessionId, data });

export const sshResize = (sessionId: string, cols: number, rows: number) =>
  invoke("ssh_resize", { sessionId, cols, rows });

export const sshDisconnect = (sessionId: string) =>
  invoke("ssh_disconnect", { sessionId });

// Terminal-agnostic dispatch: SSH sessions vs. telnet/mosh PTY sessions.
export const termKindWrite = (
  kind: string | undefined,
  backendId: string,
  data: number[],
) =>
  kind === "telnet" || kind === "mosh"
    ? termWrite(backendId, data)
    : sshWrite(backendId, data);

export const termKindResize = (
  kind: string | undefined,
  backendId: string,
  cols: number,
  rows: number,
) =>
  kind === "telnet" || kind === "mosh"
    ? termResize(backendId, cols, rows)
    : sshResize(backendId, cols, rows);

export const termKindClose = (kind: string | undefined, backendId: string) =>
  kind === "telnet" || kind === "mosh"
    ? termClose(backendId)
    : kind === "ftp"
      ? ftpDisconnect(backendId)
      : sshDisconnect(backendId);

export const sshDetectOS = (sessionId: string) =>
  invoke<string>("ssh_detect_os", { sessionId });

export const sshListSessions = () => invoke<string[]>("ssh_list_sessions");

export const sshAliveSessions = () => invoke<string[]>("ssh_alive_sessions");

export interface RemoteFile {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  permissions?: number;
  modified?: number;
}

export interface TransferProgress {
  bytes_sent: number;
  total_bytes: number;
}

export const sftpLs = (sessionId: string, path: string) =>
  invoke<RemoteFile[]>("sftp_ls", { sessionId, path });

export const sftpMkdir = (sessionId: string, path: string) =>
  invoke("sftp_mkdir", { sessionId, path });

export const sftpRename = (
  sessionId: string,
  oldPath: string,
  newPath: string,
) => invoke("sftp_rename", { sessionId, oldPath, newPath });

export const sftpRemove = (sessionId: string, path: string, isDir: boolean) =>
  invoke("sftp_remove", { sessionId, path, isDir });

export const sftpChmod = (sessionId: string, path: string, mode: number) =>
  invoke("sftp_chmod", { sessionId, path, mode });

export const sftpCopy = (sessionId: string, src: string, dst: string) =>
  invoke("sftp_copy", { sessionId, src, dst });

export const sftpCancelTransfer = (transferId: string) =>
  invoke("sftp_cancel_transfer", { transferId });

export const sftpUpload = (
  sessionId: string,
  transferId: string,
  localPath: string,
  remotePath: string,
  onProgress: Channel<TransferProgress>,
) =>
  invoke("sftp_upload", {
    sessionId,
    transferId,
    localPath,
    remotePath,
    onProgress,
  });

export const sftpDownload = (
  sessionId: string,
  transferId: string,
  remotePath: string,
  localPath: string,
  onProgress: Channel<TransferProgress>,
) =>
  invoke("sftp_download", {
    sessionId,
    transferId,
    remotePath,
    localPath,
    onProgress,
  });

export const sftpUploadRecursive = (
  sessionId: string,
  transferId: string,
  localPath: string,
  remoteDestDir: string,
  onProgress: Channel<TransferProgress>,
) =>
  invoke("sftp_upload_recursive", {
    sessionId,
    transferId,
    localPath,
    remoteDestDir,
    onProgress,
  });

export type TunnelKind = "local" | "remote" | "dynamic";

export interface TunnelSpec {
  name: string;
  kind: TunnelKind;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
}

export interface TunnelStatus {
  id: string;
  session_id: string;
  name: string;
  kind: TunnelKind;
  bind_host: string;
  bind_port: number;
  target_host: string;
  target_port: number;
  active_connections: number;
  total_connections: number;
  error: string | null;
}

export const tunnelStart = (sessionId: string, spec: TunnelSpec) =>
  invoke<TunnelStatus>("tunnel_start", { sessionId, spec });

export const tunnelStop = (sessionId: string, tunnelId: string) =>
  invoke("tunnel_stop", { sessionId, tunnelId });

export const tunnelList = (sessionId: string) =>
  invoke<TunnelStatus[]>("tunnel_list", { sessionId });

export const tunnelListAll = () => invoke<TunnelStatus[]>("tunnel_list_all");

export interface LocalFile {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
}

export const localHome = () => invoke<string>("local_home");

export const localLs = (path: string) =>
  invoke<LocalFile[]>("local_ls", { path });

export const sftpDownloadRecursive = (
  sessionId: string,
  transferId: string,
  remotePath: string,
  localDestDir: string,
  onProgress: Channel<TransferProgress>,
) =>
  invoke("sftp_download_recursive", {
    sessionId,
    transferId,
    remotePath,
    localDestDir,
    onProgress,
  });
