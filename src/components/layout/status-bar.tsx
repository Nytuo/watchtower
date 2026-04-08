import {} from "react";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";

export function StatusBar() {
  const { sessions } = useSessionStore();
  const { isUnlocked, servers } = useVaultStore();

  const connected = sessions.filter((s) => s.status === "connected").length;

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-border bg-background text-xs text-muted-foreground">
      <div className="flex items-center gap-4">
        <span>
          {isUnlocked
            ? `${servers.length} server${servers.length !== 1 ? "s" : ""}`
            : "Locked"}
        </span>
        {connected > 0 && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            {connected} active session{connected !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span>Watchtower v0.1.0</span>
      </div>
    </div>
  );
}
