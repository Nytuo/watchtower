import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Trash2, ShieldCheck, ShieldOff, Fingerprint } from "lucide-react";

export function KnownHostsViewer() {
  const { knownHosts, deleteKnownHost, trustKnownHost } = useVaultStore();
  const { addToast } = useUiStore();

  const handleDelete = async (host: string, port: number) => {
    try {
      await deleteKnownHost(host, port);
      addToast({ title: "Known host removed" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleToggleTrust = async (
    host: string,
    port: number,
    currentlyTrusted: boolean,
  ) => {
    try {
      await trustKnownHost(host, port, !currentlyTrusted);
      addToast({ title: currentlyTrusted ? "Host untrusted" : "Host trusted" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const formatFingerprint = (fp: string) => {
    if (fp.length > 32) return fp.slice(0, 32) + "...";
    return fp;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold">Known Hosts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage SSH host key fingerprints. Untrusted hosts will prompt for
            verification on connect.
          </p>
        </div>

        <div className="space-y-2">
          {knownHosts.length === 0 && (
            <div className="text-center text-muted-foreground py-10">
              <Fingerprint className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No known hosts</p>
              <p className="text-xs mt-1">
                Host keys are saved when you connect to servers
              </p>
            </div>
          )}

          {knownHosts.map((kh) => (
            <div
              key={`${kh.host}:${kh.port}`}
              className="flex items-start gap-3 px-3 py-2.5 rounded-md border border-border group"
            >
              <div className="mt-0.5 shrink-0">
                {kh.trusted ? (
                  <ShieldCheck className="h-4 w-4 text-green-500" />
                ) : (
                  <ShieldOff className="h-4 w-4 text-yellow-500" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {kh.host}:{kh.port}
                  </span>
                  <span className="text-[10px] uppercase text-muted-foreground font-mono bg-accent px-1.5 py-0.5 rounded">
                    {kh.key_type}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                  {formatFingerprint(kh.key_fingerprint)}
                </div>
                <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
                  <span>
                    First seen: {new Date(kh.first_seen).toLocaleDateString()}
                  </span>
                  {kh.last_seen && (
                    <span>
                      Last seen: {new Date(kh.last_seen).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    handleToggleTrust(kh.host, kh.port, kh.trusted)
                  }
                  title={kh.trusted ? "Untrust" : "Trust"}
                >
                  {kh.trusted ? (
                    <ShieldOff className="h-3.5 w-3.5 text-yellow-500" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => handleDelete(kh.host, kh.port)}
                  title="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
