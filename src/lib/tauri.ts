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

export interface Snippet {
  id: string;
  name: string;
  content: string;
  description: string | null;
  tags: string[];
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
}

export const vaultCreate = (password: string, path?: string) =>
  invoke("vault_create", { password, path });

export const vaultOpen = (password: string, path?: string) =>
  invoke("vault_open", { password, path });

export const vaultLock = () => invoke("vault_lock");

export const vaultIsUnlocked = () => invoke<boolean>("vault_is_unlocked");

export const vaultExists = (path?: string) =>
  invoke<boolean>("vault_exists", { path });

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
}) => invoke<Snippet>("vault_add_snippet", { ...params });

export const vaultUpdateSnippet = (params: {
  id: string;
  name?: string;
  content?: string;
  description?: string;
  tags?: string[];
}) => invoke<Snippet>("vault_update_snippet", { ...params });

export const vaultDeleteSnippet = (id: string) =>
  invoke("vault_delete_snippet", { id });

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
}) => invoke<VaultSettings>("vault_update_settings", { ...params });

export const sshConnect = (
  serverId: string,
  cols: number,
  rows: number,
  onData: Channel<number[]>,
  onLog: Channel<ConnectionLog>,
) => invoke<string>("ssh_connect", { serverId, cols, rows, onData, onLog });

export const sshSendStartupCommand = (sessionId: string, serverId: string) =>
  invoke("ssh_send_startup_command", { sessionId, serverId });

export const sshWrite = (sessionId: string, data: number[]) =>
  invoke("ssh_write", { sessionId, data });

export const sshResize = (sessionId: string, cols: number, rows: number) =>
  invoke("ssh_resize", { sessionId, cols, rows });

export const sshDisconnect = (sessionId: string) =>
  invoke("ssh_disconnect", { sessionId });

export const sshDetectOS = (sessionId: string) =>
  invoke<string>("ssh_detect_os", { sessionId });

export const sshListSessions = () => invoke<string[]>("ssh_list_sessions");

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

export const sftpUpload = (
  sessionId: string,
  localPath: string,
  remotePath: string,
  onProgress: Channel<TransferProgress>,
) => invoke("sftp_upload", { sessionId, localPath, remotePath, onProgress });

export const sftpDownload = (
  sessionId: string,
  remotePath: string,
  localPath: string,
  onProgress: Channel<TransferProgress>,
) => invoke("sftp_download", { sessionId, remotePath, localPath, onProgress });

export const sftpDownloadRecursive = (
  sessionId: string,
  remotePath: string,
  localDestDir: string,
  onProgress: Channel<TransferProgress>,
) =>
  invoke("sftp_download_recursive", {
    sessionId,
    remotePath,
    localDestDir,
    onProgress,
  });
