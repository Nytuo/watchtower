import React from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { useT } from "@/lib/i18n";
import {
  Server,
  Plus,
  Lock,
  FolderOpen,
  Tags,
  Code2,
  KeyRound,
  ArrowRightLeft,
  Fingerprint,
  Settings,
  DownloadCloud,
} from "lucide-react";

const panelButtons = [
  { panel: "groups" as const, icon: FolderOpen, k: "nav.groups" },
  { panel: "tags" as const, icon: Tags, k: "nav.tags" },
  { panel: "snippets" as const, icon: Code2, k: "nav.snippets" },
  { panel: "keychains" as const, icon: KeyRound, k: "nav.keychains" },
  {
    panel: "port-forwarding" as const,
    icon: ArrowRightLeft,
    k: "nav.portForwarding",
  },
  { panel: "known-hosts" as const, icon: Fingerprint, k: "nav.knownHosts" },
  { panel: "import" as const, icon: DownloadCloud, k: "nav.import" },
  { panel: "settings" as const, icon: Settings, k: "nav.settings" },
] as const;

export function Sidebar() {
  const { isUnlocked, lockVault } = useVaultStore();
  const {
    activePanel,
    setActivePanel,
    setShowServerForm,
    activeView,
    setActiveView,
  } = useUiStore();

  const tr = useT();

  if (!isUnlocked) return null;

  return (
    <div className="flex h-full w-[68px] shrink-0 flex-col items-center border-r border-border bg-sidebar py-2 gap-1">
      <NavItem
        icon={<Server className="h-4 w-4" />}
        label={tr("nav.servers")}
        active={activeView === "home" && activePanel === null}
        onClick={() => {
          setActivePanel(null);
          setActiveView("home");
        }}
      />

      <div className="w-7 h-px bg-border my-1" />

      {panelButtons.map(({ panel, icon: Icon, k }) => (
        <NavItem
          key={panel}
          icon={<Icon className="h-4 w-4" />}
          label={tr(k)}
          active={activePanel === panel}
          onClick={() => setActivePanel(activePanel === panel ? null : panel)}
        />
      ))}

      <div className="flex-1" />

      <NavItem
        icon={<Plus className="h-4 w-4" />}
        label="Add"
        active={false}
        onClick={() => setShowServerForm(true)}
      />

      <NavItem
        icon={<Lock className="h-4 w-4" />}
        label="Lock"
        active={false}
        onClick={() => lockVault()}
      />
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={[
        "flex flex-col items-center justify-center gap-0.5 w-[56px] rounded-md px-1 py-2 text-[10px] font-medium leading-tight transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      ].join(" ")}
    >
      {icon}
      <span className="w-full text-center truncate">{label}</span>
    </button>
  );
}
