import { useEffect, useRef } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { confirmDialog, promptDialog } from "@/stores/dialog-store";
import {
  syncStatus,
  syncPull,
  syncPush,
  vaultAdoptIncoming,
  vaultDiscardIncoming,
} from "@/lib/tauri";

let suppressPushUntil = 0;
let pulling = false;

async function pullAndReload() {
  if (pulling) return;
  pulling = true;
  try {
    const { pending } = await syncPull();
    if (!pending) {
      useUiStore.getState().addToast({ title: "Already up to date" });
      return;
    }
    const pw = await promptDialog({
      title: "Apply synced changes",
      message:
        "Enter your master password to load the vault pulled from the remote.",
    });
    if (!pw) {
      await vaultDiscardIncoming();
      return;
    }
    try {
      await vaultAdoptIncoming(pw);
      suppressPushUntil = Date.now() + 15000;
      await useVaultStore.getState().refreshAll();
      useUiStore.getState().addToast({ title: "Vault synced from remote" });
    } catch (e) {
      await vaultDiscardIncoming();
      useUiStore.getState().addToast({
        title: "Sync not applied",
        description: String(e),
        variant: "destructive",
      });
    }
  } finally {
    pulling = false;
  }
}

export function useSync() {
  const isUnlocked = useVaultStore((s) => s.isUnlocked);
  const settings = useVaultStore((s) => s.settings);
  const checkedRef = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isUnlocked) checkedRef.current = false;
    if (!isUnlocked || checkedRef.current) return;
    if (!settings || settings.sync_mode === "off" || !settings.sync_auto)
      return;
    checkedRef.current = true;
    const t = setTimeout(async () => {
      try {
        const st = await syncStatus();
        if (st.configured && st.remote_exists && !st.in_sync) {
          const ok = await confirmDialog({
            title: "Remote vault differs",
            message:
              "The synced copy has changes not in this vault. Pull them now? A backup of the current file is kept as .nyt.bak.",
            confirmLabel: "Pull",
          });
          if (ok) await pullAndReload();
        }
      } catch {
        /* offline / misconfigured */
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [isUnlocked, settings]);

  useEffect(() => {
    if (!isUnlocked) return;
    if (!settings || settings.sync_mode === "off" || !settings.sync_auto)
      return;
    const unsub = useVaultStore.subscribe((state, prev) => {
      if (
        state.servers === prev.servers &&
        state.groups === prev.groups &&
        state.tags === prev.tags &&
        state.snippets === prev.snippets &&
        state.keychains === prev.keychains &&
        state.portForwardings === prev.portForwardings &&
        state.knownHosts === prev.knownHosts &&
        state.settings === prev.settings
      )
        return;
      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        if (
          pulling ||
          Date.now() < suppressPushUntil ||
          !useVaultStore.getState().isUnlocked
        )
          return;
        syncPush().catch(() => {});
      }, 8000);
    });
    return () => {
      unsub();
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [isUnlocked, settings]);
}

export { pullAndReload };
