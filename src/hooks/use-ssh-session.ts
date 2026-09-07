import { useCallback } from "react";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { termKindClose } from "@/lib/tauri";

export function useSshSession() {
  const { removeSession, sessions, activeSessionId } = useSessionStore();
  const { servers } = useVaultStore();
  const { addToast } = useUiStore();

  const connect = useCallback(
    async (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        addToast({
          title: "Error",
          description: "Server not found",
          variant: "destructive",
        });
        return null;
      }

      return server;
    },
    [servers, addToast],
  );

  const disconnect = useCallback(
    async (sessionId: string) => {
      const s = useSessionStore.getState().getSession(sessionId);
      try {
        if (s?.backendId) await termKindClose(s.kind, s.backendId);
      } catch {}
      removeSession(sessionId);
    },
    [removeSession],
  );

  return {
    sessions,
    activeSessionId,
    connect,
    disconnect,
  };
}
