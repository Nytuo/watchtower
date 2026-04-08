import { useCallback } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";

export function useVault() {
  const store = useVaultStore();
  const { addToast } = useUiStore();

  const safeAction = useCallback(
    async <T>(
      action: () => Promise<T>,
      successMsg?: string,
    ): Promise<T | undefined> => {
      try {
        const result = await action();
        if (successMsg) {
          addToast({ title: successMsg });
        }
        return result;
      } catch (e) {
        addToast({
          title: "Error",
          description: String(e),
          variant: "destructive",
        });
        return undefined;
      }
    },
    [addToast],
  );

  return {
    ...store,
    safeAction,
  };
}
