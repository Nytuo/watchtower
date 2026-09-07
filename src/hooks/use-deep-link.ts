import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVaultStore } from "@/stores/vault-store";
import { connectAdhoc } from "@/lib/connect";
import { parseTarget } from "@/stores/adhoc-store";
import { confirmDialog } from "@/stores/dialog-store";

async function handleUrl(url: string) {
  try {
    if (!useVaultStore.getState().isUnlocked) return;
    if (!url.startsWith("ssh://")) return;
    const target = parseTarget(url.slice("ssh://".length));
    if (!target) return;
    const ok = await confirmDialog({
      title: "Open SSH connection from a link?",
      message: `${target.username}@${target.host}:${target.port}\n\nThis link came from outside Watchtower. Only continue if you trust its source.`,
      confirmLabel: "Connect",
    });
    if (ok) connectAdhoc({ ...target, authType: "agent" });
  } catch {
    /* malformed link */
  }
}

export function useDeepLink() {
  useEffect(() => {
    const un = listen<string[]>("deep-link", (e) => {
      for (const url of e.payload) void handleUrl(url);
    });

    import("@tauri-apps/plugin-deep-link")
      .then((m) => m.getCurrent())
      .then((urls) => {
        if (urls) for (const u of urls) void handleUrl(u);
      })
      .catch(() => {});

    return () => {
      un.then((f) => f());
    };
  }, []);
}
