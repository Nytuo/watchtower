import React from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Sidebar } from "@/components/layout/sidebar";
import { TabBar } from "@/components/layout/tab-bar";
import { StatusBar } from "@/components/layout/status-bar";
import { GroupManager } from "@/components/vault/group-manager";
import { TagManager } from "@/components/vault/tag-manager";
import { SnippetsPanel } from "@/components/vault/snippets-panel";
import { KeychainManager } from "@/components/vault/keychain-manager";
import { PortForwardingPanel } from "@/components/vault/port-forwarding-panel";
import { KnownHostsViewer } from "@/components/vault/known-hosts-viewer";
import { SettingsPanel } from "@/components/vault/settings-panel";

interface AppShellProps {
  children: React.ReactNode;
}

const PANEL_COMPONENTS: Record<string, React.ComponentType> = {
  groups: GroupManager,
  tags: TagManager,
  snippets: SnippetsPanel,
  keychains: KeychainManager,
  "port-forwarding": PortForwardingPanel,
  "known-hosts": KnownHostsViewer,
  settings: SettingsPanel,
};

export function AppShell({ children }: AppShellProps) {
  const { isUnlocked } = useVaultStore();
  const { activePanel } = useUiStore();

  const PanelComponent =
    isUnlocked && activePanel ? (PANEL_COMPONENTS[activePanel] ?? null) : null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />

        <div className="flex flex-1 flex-col overflow-hidden">
          <TabBar />

          <div className="flex-1 overflow-hidden">
            {PanelComponent ? <PanelComponent /> : children}
          </div>
        </div>
      </div>

      <StatusBar />
    </div>
  );
}
