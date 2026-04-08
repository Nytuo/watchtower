import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { tunnelListAll, syncStatus } from "@/lib/tauri";
import { Radio, RefreshCw, Gauge } from "lucide-react";

export function StatusBar() {
  const { sessions, activeSessionId } = useSessionStore();
  const { isUnlocked, servers, settings } = useVaultStore();

  const [tunnels, setTunnels] = useState(0);
  const [sync, setSync] = useState<"off" | "ok" | "diff" | "err">("off");

  const connected = sessions.filter((s) => s.status === "connected").length;
  const active = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    if (!isUnlocked) return;
    const tick = async () => {
      try {
        setTunnels((await tunnelListAll()).length);
      } catch {
        setTunnels(0);
      }
      if (settings && settings.sync_mode !== "off") {
        try {
          const st = await syncStatus();
          setSync(!st.configured ? "off" : st.in_sync ? "ok" : "diff");
        } catch {
          setSync("err");
        }
      } else {
        setSync("off");
      }
    };
    tick();
    const iv = setInterval(tick, 20000);
    return () => clearInterval(iv);
  }, [isUnlocked, settings]);

  return (
    <div className="flex items-center justify-between border-t border-border bg-background px-3 py-1 text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>
          {isUnlocked
            ? `${servers.length} server${servers.length !== 1 ? "s" : ""}`
            : "Locked"}
        </span>
        {connected > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {connected} session{connected !== 1 ? "s" : ""}
          </span>
        )}
        {active?.latencyMs != null && (
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            {active.latencyMs} ms
          </span>
        )}
        {tunnels > 0 && (
          <span className="flex items-center gap-1">
            <Radio className="h-3 w-3 text-green-500" />
            {tunnels} tunnel{tunnels !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {sync !== "off" && (
          <span
            className="flex items-center gap-1"
            title={
              sync === "ok"
                ? "Vault in sync"
                : sync === "diff"
                  ? "Local and remote differ"
                  : "Sync error"
            }
          >
            <RefreshCw
              className={`h-3 w-3 ${
                sync === "ok"
                  ? "text-green-500"
                  : sync === "diff"
                    ? "text-yellow-500"
                    : "text-destructive"
              }`}
            />
            sync
          </span>
        )}
        <span>Watchtower</span>
      </div>
    </div>
  );
}
