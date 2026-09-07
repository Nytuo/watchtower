import { useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { confirmDialog } from "@/stores/dialog-store";
import {
  importSshConfig,
  importPutty,
  importSecurecrt,
  importJsonFile,
  exportJsonTo,
  exportSshConfig,
  cloudListDigitalocean,
  cloudListAws,
  cloudListAzure,
  cloudImportHosts,
  type ImportResult,
  type CloudHost,
} from "@/lib/tauri";
import {
  open as openDialog,
  save as saveDialog,
} from "@tauri-apps/plugin-dialog";
import {
  Terminal,
  HardDrive,
  FileJson,
  Cloud,
  DownloadCloud,
} from "lucide-react";

export function ImportPanel() {
  const { refreshServers, refreshGroups } = useVaultStore();
  const { addToast } = useUiStore();
  const [busy, setBusy] = useState<string | null>(null);

  const [doToken, setDoToken] = useState("");
  const [doHosts, setDoHosts] = useState<CloudHost[]>([]);
  const [doSel, setDoSel] = useState<Set<string>>(new Set());
  const [doUser, setDoUser] = useState("root");
  const [doPrivate, setDoPrivate] = useState(false);
  const [doGroup, setDoGroup] = useState("DigitalOcean");

  const report = (r: ImportResult) => {
    refreshServers();
    addToast({
      title: `Imported ${r.added} server${r.added === 1 ? "" : "s"}`,
      description:
        r.skipped > 0
          ? `${r.skipped} already existed and were skipped.`
          : r.names.slice(0, 8).join(", "),
    });
  };

  const run = async (key: string, fn: () => Promise<ImportResult>) => {
    setBusy(key);
    try {
      report(await fn());
    } catch (e) {
      addToast({
        title: "Import failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const pickPutty = async () => {
    const p = await openDialog({
      title: "PuTTY sessions folder or .reg file",
      directory: false,
    });
    if (p) run("putty", () => importPutty(p as string));
  };

  const pickSecurecrt = async () => {
    const p = await openDialog({
      title: "SecureCRT Sessions folder",
      directory: true,
    });
    if (p) run("securecrt", () => importSecurecrt(p as string));
  };

  const pickJson = async () => {
    const p = await openDialog({
      title: "Import JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (p) run("json", () => importJsonFile(p as string));
  };

  const doExport = async () => {
    const ok = await confirmDialog({
      title: "Export server list as plain JSON?",
      message:
        "The export contains hostnames, usernames and ports in the clear (no passwords or keys). Keep the file somewhere safe.",
      confirmLabel: "Export",
    });
    if (!ok) return;
    const p = await saveDialog({
      defaultPath: "watchtower-servers.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!p) return;
    try {
      await exportJsonTo(p);
      addToast({ title: "Exported", description: p });
    } catch (e) {
      addToast({
        title: "Export failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const doExportSshConfig = async () => {
    const p = await saveDialog({
      defaultPath: "watchtower.sshconfig",
    });
    if (!p) return;
    try {
      const n = await exportSshConfig(p);
      addToast({
        title: `Wrote ${n} Host block${n === 1 ? "" : "s"}`,
        description: `Add "Include ${p}" to your ~/.ssh/config`,
      });
    } catch (e) {
      addToast({
        title: "Export failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const loadDo = async () => {
    if (!doToken.trim()) return;
    setBusy("do-list");
    try {
      const hosts = await cloudListDigitalocean(doToken.trim());
      setDoHosts(hosts);
      setDoSel(new Set(hosts.map((h) => h.id)));
    } catch (e) {
      addToast({
        title: "DigitalOcean error",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const importDo = async () => {
    const chosen = doHosts.filter((h) => doSel.has(h.id));
    if (chosen.length === 0) return;
    setBusy("do-import");
    try {
      const r = await cloudImportHosts({
        hosts: chosen,
        username: doUser,
        usePrivateIp: doPrivate,
        groupName: doGroup || undefined,
      });
      await Promise.all([refreshServers(), refreshGroups()]);
      addToast({
        title: `Imported ${r.added} droplet${r.added === 1 ? "" : "s"}`,
        description: r.skipped ? `${r.skipped} skipped.` : undefined,
      });
      setDoHosts([]);
    } catch (e) {
      addToast({
        title: "Import failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
        <div>
          <h2 className="text-base font-semibold">Import servers</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Bring in hosts from other tools. Credentials are never imported —
            imported servers use your SSH agent by default.
          </p>
        </div>

        <div className="space-y-2">
          <Row
            icon={<Terminal className="h-4 w-4" />}
            title="OpenSSH config"
            desc="~/.ssh/config — Host blocks with HostName, User, Port, IdentityFile, ProxyJump"
            action={
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "ssh"}
                  onClick={() => run("ssh", () => importSshConfig())}
                >
                  Import
                </Button>
                <Button size="sm" variant="ghost" onClick={doExportSshConfig}>
                  Export
                </Button>
              </div>
            }
          />
          <Row
            icon={<HardDrive className="h-4 w-4" />}
            title="PuTTY"
            desc="Sessions folder (Linux) or an exported .reg file (Windows)"
            action={
              <Button size="sm" variant="outline" onClick={pickPutty}>
                Choose…
              </Button>
            }
          />
          <Row
            icon={<HardDrive className="h-4 w-4" />}
            title="SecureCRT"
            desc="Point at your Sessions folder (.ini files)"
            action={
              <Button size="sm" variant="outline" onClick={pickSecurecrt}>
                Choose…
              </Button>
            }
          />
          <Row
            icon={<FileJson className="h-4 w-4" />}
            title="JSON"
            desc="Watchtower export, or a plain array of { name, host, port, username }"
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={pickJson}>
                  Import
                </Button>
                <Button size="sm" variant="ghost" onClick={doExport}>
                  Export
                </Button>
              </div>
            }
          />
        </div>

        <div className="space-y-3 rounded-md border border-border p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Cloud className="h-4 w-4" />
            DigitalOcean
          </div>
          <div className="flex gap-2">
            <Input
              type="password"
              value={doToken}
              onChange={(e) => setDoToken(e.target.value)}
              placeholder="API token (read scope is enough)"
              className="h-8 text-sm"
            />
            <Button
              size="sm"
              className="h-8"
              disabled={busy === "do-list"}
              onClick={loadDo}
            >
              {busy === "do-list" ? "…" : "List droplets"}
            </Button>
          </div>

          {doHosts.length > 0 && (
            <>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-border p-1">
                {doHosts.map((h) => (
                  <label
                    key={h.id}
                    className="flex items-center gap-2 px-2 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={doSel.has(h.id)}
                      onChange={() =>
                        setDoSel((p) => {
                          const n = new Set(p);
                          n.has(h.id) ? n.delete(h.id) : n.add(h.id);
                          return n;
                        })
                      }
                    />
                    <span className="flex-1 truncate">{h.name}</span>
                    <span className="font-mono text-muted-foreground">
                      {doPrivate ? h.private_ip : h.public_ip}
                    </span>
                    <span className="text-muted-foreground">{h.region}</span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">SSH username</Label>
                  <Input
                    value={doUser}
                    onChange={(e) => setDoUser(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Group</Label>
                  <Input
                    value={doGroup}
                    onChange={(e) => setDoGroup(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={doPrivate}
                  onChange={(e) => setDoPrivate(e.target.checked)}
                />
                Use private IPs
              </label>
              <Button
                size="sm"
                className="w-full"
                disabled={busy === "do-import"}
                onClick={importDo}
              >
                <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
                Import {doSel.size} selected
              </Button>
            </>
          )}
        </div>

        <CloudImporter
          title="AWS EC2"
          defaultGroup="AWS"
          fields={[
            { key: "accessKey", label: "Access key ID" },
            { key: "secretKey", label: "Secret access key", secret: true },
            { key: "region", label: "Region", placeholder: "us-east-1" },
            {
              key: "sessionToken",
              label: "Session token (optional)",
              secret: true,
              optional: true,
            },
          ]}
          list={(v) =>
            cloudListAws({
              accessKey: v.accessKey,
              secretKey: v.secretKey,
              region: v.region,
              sessionToken: v.sessionToken || undefined,
            })
          }
          onImported={() => Promise.all([refreshServers(), refreshGroups()])}
        />

        <CloudImporter
          title="Azure VMs"
          defaultGroup="Azure"
          fields={[
            { key: "tenantId", label: "Tenant ID" },
            { key: "clientId", label: "Client ID" },
            { key: "clientSecret", label: "Client secret", secret: true },
            { key: "subscriptionId", label: "Subscription ID" },
          ]}
          list={(v) =>
            cloudListAzure({
              tenantId: v.tenantId,
              clientId: v.clientId,
              clientSecret: v.clientSecret,
              subscriptionId: v.subscriptionId,
            })
          }
          onImported={() => Promise.all([refreshServers(), refreshGroups()])}
        />
      </div>
    </div>
  );
}

function CloudImporter({
  title,
  defaultGroup,
  fields,
  list,
  onImported,
}: {
  title: string;
  defaultGroup: string;
  fields: {
    key: string;
    label: string;
    placeholder?: string;
    secret?: boolean;
    optional?: boolean;
  }[];
  list: (v: Record<string, string>) => Promise<CloudHost[]>;
  onImported: () => Promise<unknown>;
}) {
  const { addToast } = useUiStore();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [hosts, setHosts] = useState<CloudHost[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [user, setUser] = useState("root");
  const [group, setGroup] = useState(defaultGroup);
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState<"list" | "import" | null>(null);

  const canList = fields.every((f) => f.optional || (vals[f.key] || "").trim());

  const doList = async () => {
    setBusy("list");
    try {
      const h = await list(vals);
      setHosts(h);
      setSel(new Set(h.map((x) => x.id)));
    } catch (e) {
      addToast({
        title: `${title} error`,
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    const chosen = hosts.filter((h) => sel.has(h.id));
    if (!chosen.length) return;
    setBusy("import");
    try {
      const r = await cloudImportHosts({
        hosts: chosen,
        username: user,
        usePrivateIp: priv,
        groupName: group || undefined,
      });
      await onImported();
      addToast({
        title: `Imported ${r.added} host${r.added === 1 ? "" : "s"}`,
        description: r.skipped ? `${r.skipped} skipped.` : undefined,
      });
      setHosts([]);
    } catch (e) {
      addToast({
        title: "Import failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Cloud className="h-4 w-4" />
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type={f.secret ? "password" : "text"}
              value={vals[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) =>
                setVals((p) => ({ ...p, [f.key]: e.target.value }))
              }
              className="h-8 text-sm"
            />
          </div>
        ))}
      </div>
      <Button
        size="sm"
        className="h-8"
        disabled={busy === "list" || !canList}
        onClick={doList}
      >
        {busy === "list" ? "…" : "List instances"}
      </Button>

      {hosts.length > 0 && (
        <>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-border p-1">
            {hosts.map((h) => (
              <label
                key={h.id}
                className="flex items-center gap-2 px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  checked={sel.has(h.id)}
                  onChange={() =>
                    setSel((p) => {
                      const n = new Set(p);
                      n.has(h.id) ? n.delete(h.id) : n.add(h.id);
                      return n;
                    })
                  }
                />
                <span className="flex-1 truncate">{h.name}</span>
                <span className="font-mono text-muted-foreground">
                  {priv ? h.private_ip : h.public_ip}
                </span>
                <span className="text-muted-foreground">{h.region}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">SSH username</Label>
              <Input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Group</Label>
              <Input
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={priv}
              onChange={(e) => setPriv(e.target.checked)}
            />
            Use private IPs
          </label>
          <Button
            size="sm"
            className="w-full"
            disabled={busy === "import"}
            onClick={doImport}
          >
            <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
            Import {sel.size} selected
          </Button>
        </>
      )}
    </div>
  );
}

function Row({
  icon,
  title,
  desc,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
      {action}
    </div>
  );
}
