import React, { useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Plus, Trash2, ArrowRightLeft, X, Save } from "lucide-react";

export function PortForwardingPanel() {
  const { portForwardings, servers, addPortForwarding, deletePortForwarding } =
    useVaultStore();
  const { addToast } = useUiStore();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<"local" | "remote" | "dynamic">(
    "local",
  );
  const [localHost, setLocalHost] = useState("127.0.0.1");
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("80");
  const [serverId, setServerId] = useState("");
  const [autoStart, setAutoStart] = useState(false);

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
        localPort: parseInt(localPort),
        remoteHost,
        remotePort: parseInt(remotePort),
        serverId: serverId || undefined,
        autoStart,
      });
      addToast({ title: "Port forwarding rule created" });
      resetForm();
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
      addToast({ title: "Rule deleted" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "local":
        return "L";
      case "remote":
        return "R";
      case "dynamic":
        return "D";
      default:
        return t;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold">Port Forwarding</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage SSH tunnel / port forwarding rules.
          </p>
        </div>

        <div className="space-y-3">
          {portForwardings.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-10">
              <ArrowRightLeft className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No port forwarding rules</p>
            </div>
          )}

          {portForwardings.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md border border-border group"
            >
              <span className="text-xs font-mono bg-accent px-1.5 py-0.5 rounded">
                {typeLabel(rule.rule_type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{rule.name}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {rule.local_host}:{rule.local_port} &rarr; {rule.remote_host}:
                  {rule.remote_port}
                </div>
              </div>
              {rule.auto_start && (
                <span className="text-[10px] text-muted-foreground">auto</span>
              )}
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
                  onChange={(e) =>
                    setRuleType(
                      e.target.value as "local" | "remote" | "dynamic",
                    )
                  }
                  options={[
                    { value: "local", label: "Local (-L)" },
                    { value: "remote", label: "Remote (-R)" },
                    { value: "dynamic", label: "Dynamic (-D)" },
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Local Host</Label>
                  <Input
                    value={localHost}
                    onChange={(e) => setLocalHost(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Local Port</Label>
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
                      <Label>Remote Host</Label>
                      <Input
                        value={remoteHost}
                        onChange={(e) => setRemoteHost(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Remote Port</Label>
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
                  <Label>Link to Server (optional)</Label>
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
                  Create
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
              Add Rule
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
