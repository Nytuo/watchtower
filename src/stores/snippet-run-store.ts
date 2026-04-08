import { create } from "zustand";
import type { Snippet, SnippetRunMode } from "@/lib/tauri";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import {
  destructiveReason,
  sendToTerminal,
  systemVars,
  unresolvedVars,
  interpolate,
} from "@/lib/snippets";

interface PendingRun {
  snippet: Snippet;
  backendId: string;
  serverId: string;
  mode: SnippetRunMode;
}

interface SnippetRunStore {
  pending: PendingRun | null;
  request: (
    snippet: Snippet,
    opts?: { backendId?: string; mode?: SnippetRunMode },
  ) => void;
  clear: () => void;
}

export function resolveTargetSession(explicit?: string) {
  const { sessions, activeSessionId } = useSessionStore.getState();
  const connected = sessions.filter(
    (s) => s.status === "connected" && s.backendId,
  );
  if (explicit) {
    const s = connected.find((x) => x.backendId === explicit);
    if (s) return s;
  }
  const active = connected.find((s) => s.id === activeSessionId);
  return active ?? connected[0] ?? null;
}

export const useSnippetRunStore = create<SnippetRunStore>((set) => ({
  pending: null,

  request: (snippet, opts) => {
    const target = resolveTargetSession(opts?.backendId);
    const { addToast } = useUiStore.getState();
    if (!target || !target.backendId) {
      addToast({
        title: "No active terminal",
        description: "Connect to a server first.",
        variant: "destructive",
      });
      return;
    }

    const mode = opts?.mode ?? snippet.run_mode;
    const server = useVaultStore
      .getState()
      .servers.find((s) => s.id === target.serverId);
    const vars = unresolvedVars(snippet, server);
    const needsConfirm =
      snippet.confirm_before_run || destructiveReason(snippet.content) !== null;

    if (vars.length === 0 && !needsConfirm) {
      const text = interpolate(snippet.content, systemVars(server));
      sendToTerminal(target.backendId, text, mode === "run")
        .then(() => useVaultStore.getState().touchSnippet(snippet.id))
        .catch((e) =>
          addToast({
            title: "Snippet failed",
            description: String(e),
            variant: "destructive",
          }),
        );
      return;
    }

    set({
      pending: {
        snippet,
        backendId: target.backendId,
        serverId: target.serverId,
        mode,
      },
    });
  },

  clear: () => set({ pending: null }),
}));

export function runSnippet(
  snippet: Snippet,
  opts?: { backendId?: string; mode?: SnippetRunMode },
) {
  useSnippetRunStore.getState().request(snippet, opts);
}
