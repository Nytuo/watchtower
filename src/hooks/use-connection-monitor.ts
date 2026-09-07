import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { sshAliveSessions } from "@/lib/tauri";
import { connectServer } from "@/lib/connect";

// Polls the backend for dead SSH sessions and flags / auto-reconnects them.
export function useConnectionMonitor() {
  const attempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tick = async () => {
      const { sessions, updateSession, removeSession } =
        useSessionStore.getState();
      const connected = sessions.filter(
        (s) =>
          s.status === "connected" &&
          s.backendId &&
          (!s.kind || s.kind === "ssh"),
      );
      if (connected.length === 0) return;

      let alive: string[];
      try {
        alive = await sshAliveSessions();
      } catch {
        return;
      }
      const aliveSet = new Set(alive);

      for (const s of connected) {
        if (aliveSet.has(s.backendId!)) {
          attempted.current.delete(s.id);
          continue;
        }
        // Session's transport is gone.
        updateSession(s.id, {
          status: "error",
          error: "Connection lost (no response from server).",
        });

        const autoReconnect =
          useVaultStore.getState().settings?.auto_reconnect ?? true;
        if (autoReconnect && !attempted.current.has(s.id)) {
          attempted.current.add(s.id);
          const server = useVaultStore
            .getState()
            .servers.find((x) => x.id === s.serverId);
          if (server) {
            useUiStore.getState().addToast({
              title: "Reconnecting…",
              description: server.name,
            });
            removeSession(s.id);
            setTimeout(() => connectServer(server), 1500);
          }
        }
      }
    };

    const iv = setInterval(tick, 6000);
    return () => clearInterval(iv);
  }, []);
}
