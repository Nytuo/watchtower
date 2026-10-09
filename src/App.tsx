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
import { MobileShell } from "@/components/mobile/mobile-shell";
import { isMobile } from "@/lib/platform";
import { useKeepAlive } from "@/hooks/use-keepalive";
import { useViewportHeight } from "@/hooks/use-viewport-height";
import { useVaultChanged } from "@/hooks/use-vault-changed";
import { cleanupStaleEditFiles } from "@/lib/cleanup-temp-edits";

export default function App() {
  const { isUnlocked, checkVaultExists } = useVaultStore();
  useAutoLock();
  useConnectionMonitor();
  useDeepLink();
  useSync();
  useVaultChanged();
  useViewportHeight();
  useKeepAlive();

  useEffect(() => {
    checkVaultExists();
    cleanupStaleEditFiles();
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
      {isMobile ? (
        <MobileShell />
      ) : (
        <AppShell>
          <TerminalPage />
        </AppShell>
      )}
      {!isMobile && <CommandPalette />}
      <SnippetRunDialog />
      <ShortcutsDialog />
      <KbdPromptDialog />
      <AppDialogs />
      <Toaster />
    </>
  );
}
