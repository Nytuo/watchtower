import React, { useState, useEffect } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Save, X } from "lucide-react";
import { OS_ICONS, UnknownOS } from "@/components/icons/os-icons";
import type { AddServerParams } from "@/lib/tauri";

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
  const [saving, setSaving] = useState(false);

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
  };

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
      <DialogContent className="mx-4 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Server" : "Add Server"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the server connection details."
              : "Add a new server to your vault."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
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
                { value: "none", label: "None (agent/external)" },
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

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : isEditing ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
