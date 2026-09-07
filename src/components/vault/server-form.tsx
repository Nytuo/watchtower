import React, { useState, useEffect } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X, ChevronRight, Plus, Trash2, Wifi } from "lucide-react";
import { sshTestConnection } from "@/lib/tauri";
import { OS_ICONS, UnknownOS } from "@/components/icons/os-icons";
import type {
  AddServerParams,
  AdvancedOptions,
  JumpHost,
  ProxyConfig,
} from "@/lib/tauri";

const DEFAULT_ADVANCED: AdvancedOptions = {
  agent_forwarding: false,
  startup_command: null,
  jump_hosts: [],
  proxy: null,
  env_vars: [],
  encoding: "UTF-8",
  use_mosh: false,
  mosh_port_range: null,
  keepalive_interval: null,
  keepalive_count_max: null,
  x11_forwarding: false,
  compression: false,
  transport: { type: "direct" },
};

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];
const DEFAULT_PORTS: Record<string, string> = {
  ssh: "22",
  sftp: "22",
  ftp: "21",
  ftps: "990",
  telnet: "23",
  mosh: "22",
};

export function ServerForm() {
  const { addServer, updateServer, servers, groups, tags, keychains } =
    useVaultStore();
  const { showServerForm, setShowServerForm, editingServerId, addToast } =
    useUiStore();

  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [keyPath, setKeyPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [keychainId, setKeychainId] = useState("");
  const [protocol, setProtocol] = useState("ssh");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [notes, setNotes] = useState("");
  const [groupId, setGroupId] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState<AdvancedOptions>(DEFAULT_ADVANCED);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = async () => {
    if (!editingServerId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await sshTestConnection(editingServerId);
      setTestResult(r.ok ? `✓ ${r.latency_ms} ms` : `✗ ${r.error ?? "failed"}`);
    } catch (e) {
      setTestResult(`✗ ${String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const isEditing = editingServerId !== null;

  useEffect(() => {
    if (editingServerId) {
      const server = servers.find((s) => s.id === editingServerId);
      if (server) {
        setName(server.name);
        setHost(server.host);
        setPort(String(server.port));
        setUsername(server.username);
        setAuthType(server.auth_type);
        setProtocol(server.protocol);
        setColor(server.color || "");
        setIcon(server.icon || "");
        setNotes(server.notes || "");
        setGroupId(server.group_id || "");
        setSelectedTags(server.tags || []);
        setKeychainId(server.keychain_id || "");
        setAdvanced({
          ...DEFAULT_ADVANCED,
          ...(server.advanced ?? {}),
          transport: server.advanced?.transport ?? { type: "direct" },
        });
      }
    } else {
      resetForm();
    }
  }, [editingServerId, servers]);

  const resetForm = () => {
    setName("");
    setHost("");
    setPort("22");
    setUsername("");
    setAuthType("password");
    setPassword("");
    setPrivateKey("");
    setKeyPath("");
    setPassphrase("");
    setKeychainId("");
    setProtocol("ssh");
    setColor("");
    setIcon("");
    setNotes("");
    setGroupId("");
    setSelectedTags([]);
    setAdvanced(DEFAULT_ADVANCED);
    setShowAdvanced(false);
  };

  const buildAdvanced = (): AdvancedOptions => advanced;

  const handleClose = () => {
    setShowServerForm(false);
    resetForm();
  };

  const handleProtocolChange = (newProto: string) => {
    setProtocol(newProto);

    const oldDefault = DEFAULT_PORTS[protocol];
    if (port === oldDefault || port === "") {
      setPort(DEFAULT_PORTS[newProto] || "22");
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (isEditing) {
        await updateServer({
          id: editingServerId!,
          name,
          host,
          port: parseInt(port),
          username,
          authType,
          password: authType === "password" ? password : undefined,
          privateKey: authType === "key" ? privateKey : undefined,
          keyPath: authType === "key_file" ? keyPath : undefined,
          passphrase:
            (authType === "key" || authType === "key_file") && passphrase
              ? passphrase
              : undefined,
          keychainId: authType === "keychain" ? keychainId : undefined,
          protocol,
          advanced: buildAdvanced(),
          color: color || undefined,
          icon: icon || undefined,
          notes: notes || undefined,
          groupId: groupId || undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });
        addToast({
          title: "Server updated",
          description: `${name} has been updated.`,
        });
      } else {
        const params: AddServerParams = {
          name,
          host,
          port: parseInt(port),
          username,
          authType,
          protocol,
          advanced: buildAdvanced(),
          color: color || undefined,
          icon: icon || undefined,
          notes: notes || undefined,
          groupId: groupId || undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        };

        if (authType === "password") {
          params.password = password;
        } else if (authType === "key") {
          params.privateKey = privateKey;
          if (passphrase) params.passphrase = passphrase;
        } else if (authType === "key_file") {
          params.keyPath = keyPath;
          if (passphrase) params.passphrase = passphrase;
        } else if (authType === "keychain") {
          params.keychainId = keychainId;
        }

        await addServer(params);
        addToast({
          title: "Server added",
          description: `${name} has been saved to your vault.`,
        });
      }
      handleClose();
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={showServerForm} onClose={handleClose}>
      <DialogContent>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>
              {isEditing ? "Edit Server" : "Add Server"}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the server connection details."
                : "Add a new server to your vault."}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="space-y-2">
              <Label>
                Icon (auto-detected on first connect, or pick manually)
              </Label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`h-8 w-8 rounded border flex items-center justify-center transition-all ${
                    icon === ""
                      ? "border-primary bg-accent scale-110"
                      : "border-transparent hover:border-muted-foreground/30"
                  }`}
                  onClick={() => setIcon("")}
                  title="Auto-detect"
                >
                  <UnknownOS size={18} />
                </button>
                {OS_ICONS.map((os) => {
                  const Icon = os.component;
                  return (
                    <button
                      key={os.slug}
                      type="button"
                      className={`h-8 w-8 rounded border flex items-center justify-center transition-all ${
                        icon === os.slug
                          ? "border-primary bg-accent scale-110"
                          : "border-transparent hover:border-muted-foreground/30"
                      }`}
                      onClick={() => setIcon(icon === os.slug ? "" : os.slug)}
                      title={os.label}
                    >
                      <Icon size={18} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Server"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  min={1}
                  max={65535}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="root"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="protocol">Protocol</Label>
                <Select
                  id="protocol"
                  value={protocol}
                  onChange={(e) => handleProtocolChange(e.target.value)}
                  options={[
                    { value: "ssh", label: "SSH" },
                    { value: "sftp", label: "SFTP" },
                    { value: "ftp", label: "FTP" },
                    { value: "ftps", label: "FTPS" },
                    { value: "telnet", label: "Telnet" },
                    { value: "mosh", label: "Mosh" },
                  ]}
                />
              </div>
            </div>

            {groups.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="groupId">Group (optional)</Label>
                <Select
                  id="groupId"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  options={[
                    { value: "", label: "No Group" },
                    ...groups.map((g) => ({
                      value: g.id,
                      label: `${g.icon ? g.icon + " " : ""}${g.name}`,
                    })),
                  ]}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="authType">Authentication</Label>
              <Select
                id="authType"
                value={authType}
                onChange={(e) => setAuthType(e.target.value)}
                options={[
                  { value: "password", label: "Password" },
                  { value: "key", label: "Private Key (paste)" },
                  { value: "key_file", label: "Key File (path)" },
                  ...(keychains.length > 0
                    ? [{ value: "keychain", label: "Keychain Entry" }]
                    : []),
                  { value: "agent", label: "SSH Agent" },
                  { value: "none", label: "None (external)" },
                ]}
              />
            </div>

            {authType === "password" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Server password"
                />
              </div>
            )}

            {authType === "key" && (
              <div className="space-y-2">
                <Label htmlFor="privateKey">Private Key</Label>
                <Textarea
                  id="privateKey"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  rows={4}
                />
              </div>
            )}

            {authType === "key_file" && (
              <div className="space-y-2">
                <Label htmlFor="keyPath">Key File Path</Label>
                <Input
                  id="keyPath"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </div>
            )}

            {(authType === "key" || authType === "key_file") && (
              <div className="space-y-2">
                <Label htmlFor="passphrase">Key Passphrase (optional)</Label>
                <Input
                  id="passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Key passphrase"
                />
              </div>
            )}

            {authType === "keychain" && (
              <div className="space-y-2">
                <Label htmlFor="keychainId">Keychain Entry</Label>
                <Select
                  id="keychainId"
                  value={keychainId}
                  onChange={(e) => setKeychainId(e.target.value)}
                  required
                  options={[
                    { value: "", label: "— Select a keychain entry —" },
                    ...keychains.map((k) => ({
                      value: k.id,
                      label: `${k.name} (${k.credential.type})`,
                    })),
                  ]}
                />
              </div>
            )}

            {tags.length > 0 && (
              <div className="space-y-2">
                <Label>Tags (optional)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={`px-2.5 py-0.5 rounded-full text-xs border transition-all ${
                        selectedTags.includes(tag.id)
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-muted-foreground hover:border-muted-foreground"
                      }`}
                      style={
                        tag.color && selectedTags.includes(tag.id)
                          ? {
                              borderColor: tag.color,
                              backgroundColor: tag.color + "20",
                            }
                          : tag.color
                            ? { borderColor: tag.color + "60" }
                            : undefined
                      }
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Color Label (optional)</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      color === c
                        ? "border-white scale-110"
                        : "border-transparent hover:border-white/50"
                    }`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(color === c ? "" : c)}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes about this server..."
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="transport">Transport</Label>
              <Select
                id="transport"
                value={advanced.transport?.type ?? "direct"}
                onChange={(e) => {
                  const v = e.target.value;
                  setAdvanced((a) => ({
                    ...a,
                    transport:
                      v === "websocket"
                        ? {
                            type: "websocket",
                            url:
                              a.transport?.type === "websocket"
                                ? a.transport.url
                                : "",
                          }
                        : v === "command"
                          ? {
                              type: "command",
                              command:
                                a.transport?.type === "command"
                                  ? a.transport.command
                                  : "",
                            }
                          : { type: "direct" },
                  }));
                }}
                options={[
                  { value: "direct", label: "Direct TCP" },
                  {
                    value: "websocket",
                    label: "SSH over WebSocket (wstunnel)",
                  },
                  { value: "command", label: "ProxyCommand (subprocess)" },
                ]}
              />
              {advanced.transport?.type === "websocket" && (
                <Input
                  value={advanced.transport.url}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      transport: { type: "websocket", url: e.target.value },
                    }))
                  }
                  placeholder="wss://gateway.example.com/ws"
                />
              )}
              {advanced.transport?.type === "command" && (
                <Input
                  value={advanced.transport.command}
                  onChange={(e) =>
                    setAdvanced((a) => ({
                      ...a,
                      transport: { type: "command", command: e.target.value },
                    }))
                  }
                  placeholder="cloudflared access ssh --hostname %h"
                  className="font-mono text-xs"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {advanced.transport?.type === "command"
                  ? "Runs a command whose stdio is the connection (%h host, %p port), like OpenSSH ProxyCommand."
                  : "WebSocket transport tunnels the SSH stream through a wss:// endpoint for restrictive networks."}
              </p>
            </div>

            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium"
              >
                <ChevronRight
                  className={`h-3.5 w-3.5 transition-transform ${
                    showAdvanced ? "rotate-90" : ""
                  }`}
                />
                Advanced (jump hosts, proxy, environment, keep-alive)
              </button>
              {showAdvanced && (
                <div className="border-t border-border p-3">
                  <AdvancedSection value={advanced} onChange={setAdvanced} />
                </div>
              )}
            </div>
          </DialogBody>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEditing ? (
              <Button
                type="button"
                variant="ghost"
                disabled={testing}
                onClick={handleTest}
              >
                <Wifi className="mr-2 h-4 w-4" />
                {testResult ?? (testing ? "Testing…" : "Test connection")}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : isEditing ? "Update" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const AUTH_OPTS = [
  { value: "password", label: "Password" },
  { value: "key", label: "Private key (paste)" },
  { value: "key_file", label: "Key file (path)" },
  { value: "agent", label: "SSH agent" },
];

function jumpAuthValue(j: JumpHost): string {
  return j.auth.type;
}

function AdvancedSection({
  value,
  onChange,
}: {
  value: AdvancedOptions;
  onChange: React.Dispatch<React.SetStateAction<AdvancedOptions>>;
}) {
  const set = (patch: Partial<AdvancedOptions>) =>
    onChange((a) => ({ ...a, ...patch }));

  const setJump = (i: number, patch: Partial<JumpHost>) =>
    onChange((a) => ({
      ...a,
      jump_hosts: a.jump_hosts.map((j, idx) =>
        idx === i ? { ...j, ...patch } : j,
      ),
    }));

  const proxy = value.proxy;
  const setProxy = (patch: Partial<ProxyConfig>) =>
    onChange((a) => ({
      ...a,
      proxy: {
        proxy_type: "socks5",
        host: "127.0.0.1",
        port: 1080,
        username: null,
        password: null,
        ...(a.proxy ?? {}),
        ...patch,
      },
    }));

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Jump hosts (ProxyJump chain)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() =>
              set({
                jump_hosts: [
                  ...value.jump_hosts,
                  {
                    host: "",
                    port: 22,
                    username: "",
                    auth: { type: "agent" },
                  },
                ],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add hop
          </Button>
        </div>
        {value.jump_hosts.map((j, i) => (
          <div
            key={i}
            className="space-y-2 rounded-md border border-border p-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Hop {i + 1}</span>
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() =>
                  set({
                    jump_hosts: value.jump_hosts.filter((_, idx) => idx !== i),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input
                className="col-span-2"
                placeholder="jump.example.com"
                value={j.host}
                onChange={(e) => setJump(i, { host: e.target.value })}
              />
              <Input
                type="number"
                placeholder="22"
                value={j.port}
                onChange={(e) =>
                  setJump(i, { port: parseInt(e.target.value) || 22 })
                }
              />
              <Input
                className="col-span-2"
                placeholder="username"
                value={j.username}
                onChange={(e) => setJump(i, { username: e.target.value })}
              />
              <Select
                value={jumpAuthValue(j)}
                onChange={(e) => {
                  const t = e.target.value;
                  setJump(i, {
                    auth:
                      t === "password"
                        ? { type: "password", password: "" }
                        : t === "key"
                          ? { type: "key", private_key: "" }
                          : t === "key_file"
                            ? { type: "key_file", path: "" }
                            : { type: "agent" },
                  });
                }}
                options={AUTH_OPTS}
              />
            </div>
            {j.auth.type === "password" && (
              <Input
                type="password"
                placeholder="password"
                value={j.auth.password}
                onChange={(e) =>
                  setJump(i, {
                    auth: { type: "password", password: e.target.value },
                  })
                }
              />
            )}
            {j.auth.type === "key_file" && (
              <Input
                placeholder="~/.ssh/id_ed25519"
                value={j.auth.path}
                onChange={(e) =>
                  setJump(i, {
                    auth: { type: "key_file", path: e.target.value },
                  })
                }
              />
            )}
            {j.auth.type === "key" && (
              <Textarea
                rows={2}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                value={j.auth.private_key}
                onChange={(e) =>
                  setJump(i, {
                    auth: { type: "key", private_key: e.target.value },
                  })
                }
              />
            )}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={!!proxy}
            onChange={(e) =>
              set({
                proxy: e.target.checked
                  ? {
                      proxy_type: "socks5",
                      host: "127.0.0.1",
                      port: 1080,
                      username: null,
                      password: null,
                    }
                  : null,
              })
            }
          />
          Connect through a proxy
        </label>
        {proxy && (
          <div className="grid grid-cols-3 gap-2 rounded-md border border-border p-2">
            <Select
              value={proxy.proxy_type}
              onChange={(e) =>
                setProxy({
                  proxy_type: e.target.value as ProxyConfig["proxy_type"],
                })
              }
              options={[
                { value: "socks5", label: "SOCKS5" },
                { value: "socks4", label: "SOCKS4a" },
                { value: "http", label: "HTTP CONNECT" },
              ]}
            />
            <Input
              className="col-span-2"
              placeholder="proxy host"
              value={proxy.host}
              onChange={(e) => setProxy({ host: e.target.value })}
            />
            <Input
              type="number"
              placeholder="port"
              value={proxy.port}
              onChange={(e) =>
                setProxy({ port: parseInt(e.target.value) || 1080 })
              }
            />
            <Input
              className="col-span-2"
              placeholder="username (optional)"
              value={proxy.username ?? ""}
              onChange={(e) => setProxy({ username: e.target.value || null })}
            />
            <Input
              className="col-span-3"
              type="password"
              placeholder="password (optional)"
              value={proxy.password ?? ""}
              onChange={(e) => setProxy({ password: e.target.value || null })}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Environment variables</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() =>
              set({ env_vars: [...value.env_vars, { key: "", value: "" }] })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {value.env_vars.map((ev, i) => (
          <div key={i} className="flex gap-2">
            <Input
              placeholder="NAME"
              value={ev.key}
              onChange={(e) =>
                set({
                  env_vars: value.env_vars.map((x, idx) =>
                    idx === i ? { ...x, key: e.target.value } : x,
                  ),
                })
              }
            />
            <Input
              placeholder="value"
              value={ev.value}
              onChange={(e) =>
                set({
                  env_vars: value.env_vars.map((x, idx) =>
                    idx === i ? { ...x, value: e.target.value } : x,
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() =>
                set({ env_vars: value.env_vars.filter((_, idx) => idx !== i) })
              }
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Most servers only accept whitelisted <code>AcceptEnv</code> names.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Keep-alive interval (s)</Label>
          <Input
            type="number"
            min={0}
            placeholder="0 = off"
            value={value.keepalive_interval ?? ""}
            onChange={(e) =>
              set({
                keepalive_interval: e.target.value
                  ? parseInt(e.target.value)
                  : null,
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Keep-alive max misses</Label>
          <Input
            type="number"
            min={0}
            placeholder="3"
            value={value.keepalive_count_max ?? ""}
            onChange={(e) =>
              set({
                keepalive_count_max: e.target.value
                  ? parseInt(e.target.value)
                  : null,
              })
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={value.compression}
            onChange={(e) => set({ compression: e.target.checked })}
          />
          Request compression (zlib)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={value.agent_forwarding}
            onChange={(e) => set({ agent_forwarding: e.target.checked })}
          />
          Forward SSH agent
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={value.x11_forwarding}
            onChange={(e) => set({ x11_forwarding: e.target.checked })}
          />
          Forward X11
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Triggers (on output → send text)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            onClick={() =>
              set({
                triggers: [
                  ...(value.triggers ?? []),
                  { pattern: "", send: "", once: true },
                ],
              })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {(value.triggers ?? []).map((t, i) => (
          <div
            key={i}
            className="space-y-2 rounded-md border border-border p-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Trigger {i + 1}
              </span>
              <label className="ml-auto flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={t.once}
                  onChange={(e) =>
                    set({
                      triggers: (value.triggers ?? []).map((x, idx) =>
                        idx === i ? { ...x, once: e.target.checked } : x,
                      ),
                    })
                  }
                />
                once
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() =>
                  set({
                    triggers: (value.triggers ?? []).filter(
                      (_, idx) => idx !== i,
                    ),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
            <Input
              placeholder="regex to match in the terminal output"
              value={t.pattern}
              className="font-mono text-xs"
              onChange={(e) =>
                set({
                  triggers: (value.triggers ?? []).map((x, idx) =>
                    idx === i ? { ...x, pattern: e.target.value } : x,
                  ),
                })
              }
            />
            <Input
              placeholder="text to send (use \n for Enter)"
              value={t.send}
              className="font-mono text-xs"
              onChange={(e) =>
                set({
                  triggers: (value.triggers ?? []).map((x, idx) =>
                    idx === i ? { ...x, send: e.target.value } : x,
                  ),
                })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
