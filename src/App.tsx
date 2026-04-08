import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ServerForm } from "@/components/vault/server-form";
import { TerminalPage } from "@/pages/terminal-page";
import { VaultPage } from "@/pages/vault-page";
import { Toaster } from "@/components/ui/toaster";
import { useVaultStore } from "@/stores/vault-store";

export default function App() {
  const { isUnlocked, checkVaultExists } = useVaultStore();

  useEffect(() => {
    checkVaultExists();
  }, [checkVaultExists]);

  if (!isUnlocked) {
    return (
      <>
        <VaultPage />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <ServerForm />
      <AppShell>
        <TerminalPage />
      </AppShell>
      <Toaster />
    </>
  );
}
