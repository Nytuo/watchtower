import React, { useState, useEffect, useCallback } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ArrowRightLeft,
  X,
  Save,
  Play,
  Square,
  Radio,
} from "lucide-react";
import {
  tunnelListAll,
  tunnelStart,
  tunnelStop,
  type TunnelStatus,
  type TunnelKind,
} from "@/lib/tauri";

const KIND_LABEL: Record<TunnelKind, string> = {
  local: "Local (-L)",
  remote: "Remote (-R)",
  dynamic: "Dynamic SOCKS (-D)",
};

export function PortForwardingPanel() {
  const { portForwardings, servers, addPortForwarding, deletePortForwarding } =
    useVaultStore();
  const { addToast } = useUiStore();
  const { sessions } = useSessionStore();

  const connectedSessions = sessions.filter(
    (s) => s.status === "connected" && s.backendId,
  );

  const [live, setLive] = useState<TunnelStatus[]>([]);
  const [targetSession, setTargetSession] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<TunnelKind>("local");
  const [localHost, setLocalHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("80");
  const [serverId, setServerId] = useState("");
  const [autoStart, setAutoStart] = useState(false);

  const refreshLive = useCallback(async () => {
    try {
      setLive(await tunnelListAll());
    } catch {
      setLive([]);
    }
  }, []);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, 2000);
    return () => clearInterval(t);
  }, [refreshLive]);

  useEffect(() => {
    if (!targetSession && connectedSessions[0]) {
      setTargetSession(connectedSessions[0].backendId!);
    }
  }, [connectedSessions, targetSession]);

  const resetForm = () => {
    setName("");
    setRuleType("local");
    setLocalHost("127.0.0.1");
    setLocalPort("8080");
    setRemoteHost("127.0.0.1");
    setRemotePort("80");
    setServerId("");
    setAutoStart(false);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await addPortForwarding({
        name,
        ruleType,
        localHost,
        localPort: parseInt(localPort) || 0,
        remoteHost,
        remotePort: parseInt(remotePort) || 0,
        serverId: serverId || undefined,
        autoStart,
      });
      addToast({ title: "Tunnel template saved" });
      resetForm();
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleStart = async (rule: {
    name: string;
    rule_type: TunnelKind;
    local_host: string;
    local_port: number;
    remote_host: string;
    remote_port: number;
  }) => {
    if (!targetSession) {
      addToast({
        title: "No active session",
        description: "Connect to a server first.",
        variant: "destructive",
      });
      return;
    }
    try {
      await tunnelStart(targetSession, {
        name: rule.name,
        kind: rule.rule_type,
        bind_host: rule.local_host || "127.0.0.1",
        bind_port: rule.local_port,
        target_host: rule.remote_host,
        target_port: rule.remote_port,
      });
      addToast({ title: `Tunnel "${rule.name}" started` });
      refreshLive();
    } catch (e) {
      addToast({
        title: "Tunnel failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleStop = async (t: TunnelStatus) => {
    try {
      await tunnelStop(t.session_id, t.id);
      addToast({ title: "Tunnel stopped" });
      refreshLive();
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePortForwarding(id);
      addToast({ title: "Template deleted" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const badge = (t: string) =>
    t === "local" ? "L" : t === "remote" ? "R" : "D";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
        <div>
          <h2 className="text-base font-semibold">
            Tunnels &amp; Port Forwarding
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Local (-L), remote (-R) and dynamic SOCKS5 (-D) tunnels over your
            SSH sessions.
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-1.5">
              <Radio className="h-3.5 w-3.5 text-green-500" />
              Active tunnels
            </h3>
            {connectedSessions.length > 0 && (
              <Select
                className="h-7 w-48 text-xs"
                value={targetSession}
                onChange={(e) => setTargetSession(e.target.value)}
                options={connectedSessions.map((s) => ({
                  value: s.backendId!,
                  label: s.serverName,
                }))}
              />
            )}
          </div>

          {live.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">
              No tunnels running.
            </p>
          ) : (
            live.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md border border-border"
              >
                <span className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
                  {badge(t.kind)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">
                    {t.bind_host}:{t.bind_port}
                    {t.kind !== "dynamic" && (
                      <>
                        {" → "}
                        {t.target_host}:{t.target_port}
                      </>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {t.active_connections} act / {t.total_connections} total
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleStop(t)}
                  title="Stop tunnel"
                >
                  <Square className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Saved templates</h3>

          {portForwardings.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-8">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No saved tunnel templates</p>
            </div>
          )}

          {portForwardings.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md border border-border group"
            >
              <span className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
                {badge(rule.rule_type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{rule.name}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {rule.local_host}:{rule.local_port}
                  {rule.rule_type !== "dynamic" && (
                    <>
                      {" → "}
                      {rule.remote_host}:{rule.remote_port}
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Start tunnel"
                disabled={!targetSession}
                onClick={() => handleStart(rule)}
              >
                <Play className="h-3.5 w-3.5 text-green-500" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100"
                onClick={() => handleDelete(rule.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          {showForm ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-3 border border-border rounded-md p-3"
            >
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Web Server Tunnel"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as TunnelKind)}
                  options={[
                    { value: "local", label: KIND_LABEL.local },
                    { value: "remote", label: KIND_LABEL.remote },
                    { value: "dynamic", label: KIND_LABEL.dynamic },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>
                    {ruleType === "remote"
                      ? "Remote bind host"
                      : "Local bind host"}
                  </Label>
                  <Input
                    value={localHost}
                    onChange={(e) => setLocalHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bind port</Label>
                  <Input
                    type="number"
                    value={localPort}
                    onChange={(e) => setLocalPort(e.target.value)}
                    required
                  />
                </div>
                {ruleType !== "dynamic" && (
                  <>
                    <div className="space-y-2">
                      <Label>Target host</Label>
                      <Input
                        value={remoteHost}
                        onChange={(e) => setRemoteHost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Target port</Label>
                      <Input
                        type="number"
                        value={remotePort}
                        onChange={(e) => setRemotePort(e.target.value)}
                        required
                      />
                    </div>
                  </>
                )}
              </div>
              {servers.length > 0 && (
                <div className="space-y-2">
                  <Label>Link to server (optional)</Label>
                  <Select
                    value={serverId}
                    onChange={(e) => setServerId(e.target.value)}
                    options={[
                      { value: "", label: "None" },
                      ...servers.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="rounded border-border"
                />
                Auto-start when session connects
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  <Save className="mr-1 h-3.5 w-3.5" />
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              New template
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
