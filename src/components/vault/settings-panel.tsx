import { useState, useEffect } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Save,
  RotateCcw,
  ShieldCheck,
  Fingerprint,
  DownloadCloud,
  Keyboard,
} from "lucide-react";
import type { VaultSettings } from "@/lib/tauri";
import {
  biometricAvailable,
  biometricHas,
  biometricClear,
  vaultCurrentPath,
} from "@/lib/tauri";
import { THEMES } from "@/lib/themes";
import { useT, useLang, LANGS, type Lang } from "@/lib/i18n";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { syncPush, syncStatus } from "@/lib/tauri";
import { pullAndReload } from "@/hooks/use-sync";
import { RefreshCw } from "lucide-react";

const REPO = "Nytuo/watchtower";

function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

export function SettingsPanel() {
  const { settings, updateSettings } = useVaultStore();
  const { activePanel, addToast, setTheme } = useUiStore();
  const tr = useT();
  const [lang, setLang] = useLang();

  const open = activePanel === "settings";

  const [form, setForm] = useState<VaultSettings>({
    theme: "dark",
    font_size: 14,
    font_family: "JetBrains Mono, monospace",
    default_shell: null,
    default_encoding: "utf-8",
    log_connections: true,
    log_retention_days: 90,
    confirm_on_disconnect: true,
    confirm_on_delete: true,
    host_key_policy: "accept-new",
    auto_lock_minutes: 15,
    auto_reconnect: true,
    sync_mode: "off",
    sync_url: null,
    sync_username: null,
    sync_password: null,
    sync_auto: true,
  });
  const [dirty, setDirty] = useState(false);

  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [version, setVersion] = useState("");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const doSyncPush = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await syncPush();
      setSyncMsg("Pushed to remote.");
    } catch (e) {
      setSyncMsg(String(e));
    } finally {
      setSyncing(false);
    }
  };
  const doSyncPull = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await pullAndReload();
      setSyncMsg("Pull complete.");
    } catch (e) {
      setSyncMsg(String(e));
    } finally {
      setSyncing(false);
    }
  };
  const doSyncStatus = async () => {
    setSyncing(true);
    try {
      const st = await syncStatus();
      setSyncMsg(
        !st.configured
          ? "Not configured — save a URL first."
          : !st.remote_exists
            ? "No remote copy yet — push to create it."
            : st.in_sync
              ? "In sync."
              : "Local and remote differ.",
      );
    } catch (e) {
      setSyncMsg(String(e));
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  const checkUpdates = async () => {
    setChecking(true);
    setUpdateMsg(null);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
      );
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name || "").replace(/^v/, "");
      if (latest && version && cmpVersion(latest, version) > 0) {
        setUpdateMsg(`Update available: v${latest}`);
      } else {
        setUpdateMsg("You're on the latest version.");
      }
    } catch (e) {
      setUpdateMsg(`Could not check (${String(e)}).`);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (settings && open) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings, open]);

  useEffect(() => {
    if (!open) return;
    vaultCurrentPath().then((p) => {
      setVaultPath(p);
      if (p) {
        biometricAvailable(p).then(setBioAvailable);
        biometricHas(p)
          .then(setBioEnabled)
          .catch(() => setBioEnabled(false));
      }
    });
  }, [open]);

  const disableBiometric = async () => {
    if (!vaultPath) return;
    try {
      await biometricClear(vaultPath);
      setBioEnabled(false);
      addToast({ title: "System keychain unlock disabled" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const update = <K extends keyof VaultSettings>(
    key: K,
    value: VaultSettings[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      await updateSettings({
        theme: form.theme,
        fontSize: form.font_size,
        fontFamily: form.font_family,
        defaultShell: form.default_shell ?? undefined,
        defaultEncoding: form.default_encoding,
        logConnections: form.log_connections,
        logRetentionDays: form.log_retention_days,
        confirmOnDisconnect: form.confirm_on_disconnect,
        confirmOnDelete: form.confirm_on_delete,
        hostKeyPolicy: form.host_key_policy,
        autoLockMinutes: form.auto_lock_minutes,
        autoReconnect: form.auto_reconnect,
        syncMode: form.sync_mode,
        syncUrl: form.sync_url ?? "",
        syncUsername: form.sync_username ?? "",
        syncPassword: form.sync_password ?? "",
        syncAuto: form.sync_auto,
      });
      setDirty(false);
      addToast({ title: "Settings saved" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    if (settings) {
      setForm(settings);
      setDirty(false);
      if (settings.theme) setTheme(settings.theme);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold">Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure application preferences.
          </p>
        </div>

        <div className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              Appearance
            </legend>

            <div className="space-y-2">
              <Label>{tr("settings.language")}</Label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as Lang)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label>Theme</Label>
              <select
                value={form.theme}
                onChange={(e) => {
                  update("theme", e.target.value);
                  setTheme(e.target.value);
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="system">System (follow OS)</option>
                {(["Base", "Popular", "Pastel"] as const).map((g) => (
                  <optgroup key={g} label={g}>
                    {Object.values(THEMES)
                      .filter((t) => t.group === g)
                      .map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.values(THEMES).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    title={t.label}
                    onClick={() => {
                      update("theme", t.key);
                      setTheme(t.key);
                    }}
                    className={`h-7 w-7 rounded-md border-2 transition-all ${
                      form.theme === t.key
                        ? "scale-110 border-foreground"
                        : "border-transparent hover:border-muted-foreground/50"
                    }`}
                    style={{
                      background: `linear-gradient(135deg, ${t.core.bg} 0 50%, ${t.core.primary} 50% 100%)`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Font Size</Label>
                <Input
                  type="number"
                  min={10}
                  max={24}
                  value={form.font_size}
                  onChange={(e) =>
                    update("font_size", parseInt(e.target.value) || 14)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Font Family</Label>
                <Select
                  value={form.font_family}
                  onChange={(e) => update("font_family", e.target.value)}
                  options={[
                    {
                      value: "JetBrains Mono, monospace",
                      label: "JetBrains Mono",
                    },
                    { value: "Fira Code, monospace", label: "Fira Code" },
                    {
                      value: "Cascadia Code, monospace",
                      label: "Cascadia Code",
                    },
                    { value: "SF Mono, monospace", label: "SF Mono" },
                    { value: "Menlo, monospace", label: "Menlo" },
                    { value: "Consolas, monospace", label: "Consolas" },
                    { value: "monospace", label: "System Mono" },
                  ]}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              Terminal
            </legend>

            <div className="space-y-2">
              <Label>Default Shell</Label>
              <Input
                value={form.default_shell ?? ""}
                onChange={(e) =>
                  update("default_shell", e.target.value || null)
                }
                placeholder="Auto-detect (e.g. /bin/bash, /bin/zsh)"
              />
            </div>

            <div className="space-y-2">
              <Label>Default Encoding</Label>
              <Select
                value={form.default_encoding}
                onChange={(e) => update("default_encoding", e.target.value)}
                options={[
                  { value: "utf-8", label: "UTF-8" },
                  { value: "iso-8859-1", label: "ISO-8859-1 (Latin-1)" },
                  { value: "windows-1252", label: "Windows-1252" },
                  { value: "shift_jis", label: "Shift JIS" },
                  { value: "euc-kr", label: "EUC-KR" },
                  { value: "gb2312", label: "GB2312" },
                ]}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              Logging
            </legend>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.log_connections}
                onChange={(e) => update("log_connections", e.target.checked)}
                className="rounded border-border"
              />
              Log connection events
            </label>

            <div className="space-y-2">
              <Label>Log Retention (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.log_retention_days}
                onChange={(e) =>
                  update("log_retention_days", parseInt(e.target.value) || 90)
                }
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-foreground">
              Confirmations
            </legend>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.confirm_on_disconnect}
                onChange={(e) =>
                  update("confirm_on_disconnect", e.target.checked)
                }
                className="rounded border-border"
              />
              Confirm before disconnecting
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.confirm_on_delete}
                onChange={(e) => update("confirm_on_delete", e.target.checked)}
                className="rounded border-border"
              />
              Confirm before deleting items
            </label>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Security
            </legend>

            <div className="space-y-2">
              <Label>Host key verification</Label>
              <Select
                value={form.host_key_policy}
                onChange={(e) => update("host_key_policy", e.target.value)}
                options={[
                  {
                    value: "accept-new",
                    label: "Trust on first use (recommended)",
                  },
                  { value: "strict", label: "Strict — only known hosts" },
                  { value: "off", label: "Off — never check (unsafe)" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                A changed host key is always rejected regardless of this
                setting. Manage trusted keys in the Known Hosts panel.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Auto-lock after inactivity (minutes)</Label>
              <Input
                type="number"
                min={0}
                max={480}
                value={form.auto_lock_minutes}
                onChange={(e) =>
                  update(
                    "auto_lock_minutes",
                    Math.max(0, parseInt(e.target.value) || 0),
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                0 disables auto-lock. The vault also locks when you click Lock.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={form.auto_reconnect}
                onChange={(e) => update("auto_reconnect", e.target.checked)}
              />
              Automatically reconnect dropped sessions
            </label>

            {bioAvailable && (
              <div className="flex items-start gap-2 rounded-md border border-border p-3">
                <Fingerprint className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="flex-1 text-sm">
                  <p className="font-medium">System keychain unlock</p>
                  <p className="text-xs text-muted-foreground">
                    {bioEnabled
                      ? "This vault's password is stored in your OS keychain. You can unlock without typing it."
                      : "Enable this from the unlock screen (“Remember on this device”)."}
                  </p>
                </div>
                {bioEnabled && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={disableBiometric}
                  >
                    Disable
                  </Button>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <RefreshCw className="h-3.5 w-3.5" />
              Encrypted sync
            </legend>
            <p className="text-xs text-muted-foreground">
              Pushes the encrypted vault file to a remote you control. The
              server never sees your data — only the AES-encrypted blob.
            </p>
            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={form.sync_mode}
                onChange={(e) => update("sync_mode", e.target.value)}
                options={[
                  { value: "off", label: "Off" },
                  { value: "webdav", label: "WebDAV (Nextcloud, …)" },
                  { value: "http", label: "HTTP(S) PUT/GET" },
                ]}
              />
            </div>
            {form.sync_mode !== "off" && (
              <>
                <div className="space-y-2">
                  <Label>
                    URL (full path to the blob, e.g.
                    https://cloud.example.com/remote.php/dav/files/me/watchtower.nyt)
                  </Label>
                  <Input
                    value={form.sync_url ?? ""}
                    onChange={(e) => update("sync_url", e.target.value || null)}
                    placeholder="https://…"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Username</Label>
                    <Input
                      value={form.sync_username ?? ""}
                      onChange={(e) =>
                        update("sync_username", e.target.value || null)
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Password / token</Label>
                    <Input
                      type="password"
                      value={
                        form.sync_password === "__SET__"
                          ? ""
                          : (form.sync_password ?? "")
                      }
                      placeholder={
                        form.sync_password === "__SET__"
                          ? "•••••••• (saved)"
                          : ""
                      }
                      onChange={(e) => update("sync_password", e.target.value)}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={form.sync_auto}
                    onChange={(e) => update("sync_auto", e.target.checked)}
                  />
                  Auto: pull on unlock, push after changes
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncing || dirty}
                    onClick={doSyncPush}
                  >
                    Push now
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={syncing || dirty}
                    onClick={doSyncPull}
                  >
                    Pull now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={syncing || dirty}
                    onClick={doSyncStatus}
                  >
                    Check status
                  </Button>
                  {dirty && (
                    <span className="text-xs text-muted-foreground">
                      save settings first
                    </span>
                  )}
                </div>
                {syncMsg && (
                  <p className="text-xs text-muted-foreground">{syncMsg}</p>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <DownloadCloud className="h-3.5 w-3.5" />
              About
            </legend>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Watchtower {version ? `v${version}` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={checkUpdates}
                disabled={checking}
              >
                {checking ? "Checking…" : "Check for updates"}
              </Button>
            </div>
            {updateMsg && (
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
                <span>{updateMsg}</span>
                <button
                  className="text-primary underline"
                  onClick={() =>
                    openUrl(`https://github.com/${REPO}/releases`).catch(
                      () => {},
                    )
                  }
                >
                  Open releases
                </button>
              </div>
            )}
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => useUiStore.getState().setShowShortcuts(true)}
            >
              <Keyboard className="h-3.5 w-3.5" />
              Keyboard shortcuts
            </button>
          </fieldset>

          <div className="flex gap-2 pt-2 border-t border-border">
            <Button size="sm" onClick={handleSave} disabled={!dirty}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={!dirty}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
