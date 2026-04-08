import { useState, useEffect } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Save, RotateCcw } from "lucide-react";
import type { VaultSettings } from "@/lib/tauri";

export function SettingsPanel() {
  const { settings, updateSettings } = useVaultStore();
  const { activePanel, addToast } = useUiStore();

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
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings && open) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings, open]);

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
              <Label>Theme</Label>
              <Select
                value={form.theme}
                onChange={(e) => update("theme", e.target.value)}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                  { value: "system", label: "System" },
                ]}
              />
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
