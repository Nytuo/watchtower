import { useEffect } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ServerForm } from "@/components/vault/server-form";
import { TerminalPage } from "@/pages/terminal-page";
import { VaultPage } from "@/pages/vault-page";
import { Toaster } from "@/components/ui/toaster";
import { CommandPalette } from "@/components/command-palette";
import { SnippetRunDialog } from "@/components/snippet-run-dialog";
import { AppDialogs } from "@/components/app-dialogs";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { KbdPromptDialog } from "@/components/kbd-prompt-dialog";
import { useVaultStore } from "@/stores/vault-store";
import { useAutoLock } from "@/hooks/use-auto-lock";
import { useConnectionMonitor } from "@/hooks/use-connection-monitor";
import { useDeepLink } from "@/hooks/use-deep-link";
import { useSync } from "@/hooks/use-sync";

export default function App() {
  const { isUnlocked, checkVaultExists } = useVaultStore();
  useAutoLock();
  useConnectionMonitor();
  useDeepLink();
  useSync();

  useEffect(() => {
    checkVaultExists();
  }, [checkVaultExists]);

  if (!isUnlocked) {
    return (
      <>
        <VaultPage />
        <AppDialogs />
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
      <CommandPalette />
      <SnippetRunDialog />
      <ShortcutsDialog />
      <KbdPromptDialog />
      <AppDialogs />
      <Toaster />
    </>
  );
}
