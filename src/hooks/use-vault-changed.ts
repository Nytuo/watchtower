import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVaultStore } from "@/stores/vault-store";

export function useVaultChanged() {
  useEffect(() => {
    const un = listen("vault-changed", () => {
      useVaultStore.getState().refreshAll();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);
}
