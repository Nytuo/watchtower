import { useEffect, useMemo, useState } from "react";
import {
  Server,
  Terminal as TerminalIcon,
  Code2,
  Menu,
  Plus,
  Search,
  ChevronLeft,
  X,
  FolderOpen,
  Tags,
  KeyRound,
  ArrowRightLeft,
  Fingerprint,
  DownloadCloud,
  Radio,
  Settings,
  Lock,
  FolderTree,
} from "lucide-react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { useMobileStore, type MobileTab } from "@/stores/mobile-store";
import { connectServer } from "@/lib/connect";
import { TerminalPage } from "@/pages/terminal-page";
import { getKeepAlive, setKeepAlive } from "@/hooks/use-keepalive";
import { isAndroid } from "@/lib/platform";
import { MobileFiles } from "@/components/mobile/mobile-files";
import { useKeyboardOpen } from "@/hooks/use-viewport-height";
import { KeyRow } from "@/components/mobile/key-row";
import { GroupManager } from "@/components/vault/group-manager";
import { TagManager } from "@/components/vault/tag-manager";
import { SnippetsPanel } from "@/components/vault/snippets-panel";
import { KeychainManager } from "@/components/vault/keychain-manager";
import { PortForwardingPanel } from "@/components/vault/port-forwarding-panel";
import { KnownHostsViewer } from "@/components/vault/known-hosts-viewer";
import { ImportPanel } from "@/components/vault/import-panel";
import { LanSyncPanel } from "@/components/vault/lan-sync-panel";
import { SettingsPanel } from "@/components/vault/settings-panel";

const MORE: {
  panel: NonNullable<ReturnType<typeof useUiStore.getState>["activePanel"]>;
  label: string;
  icon: typeof Server;
  C: React.ComponentType;
}[] = [
  { panel: "lan-sync", label: "Sync nearby", icon: Radio, C: LanSyncPanel },
  { panel: "groups", label: "Groups", icon: FolderOpen, C: GroupManager },
  { panel: "tags", label: "Tags", icon: Tags, C: TagManager },
  { panel: "keychains", label: "Keychains", icon: KeyRound, C: KeychainManager },
  {
    panel: "port-forwarding",
    label: "Tunnels",
    icon: ArrowRightLeft,
    C: PortForwardingPanel,
  },
  {
    panel: "known-hosts",
    label: "Known hosts",
    icon: Fingerprint,
    C: KnownHostsViewer,
  },
  { panel: "import", label: "Import", icon: DownloadCloud, C: ImportPanel },
  { panel: "settings", label: "Settings", icon: Settings, C: SettingsPanel },
];

export function MobileShell() {
  const tab = useMobileStore((s) => s.tab);
  const setTab = useMobileStore((s) => s.setTab);
  const sessionCount = useSessionStore((s) => s.sessions.length);
  const keyboard = useKeyboardOpen();

  const tabs: { id: MobileTab; label: string; icon: typeof Server }[] = [
    { id: "hosts", label: "Hosts", icon: Server },
    { id: "sessions", label: "Sessions", icon: TerminalIcon },
    { id: "snippets", label: "Snippets", icon: Code2 },
    { id: "more", label: "More", icon: Menu },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "hosts" && <Hosts />}
        <div className={tab === "sessions" ? "h-full" : "hidden"}>
          <Sessions visible={tab === "sessions"} />
        </div>
        {tab === "snippets" && <SnippetsPanel />}
        {tab === "more" && <More />}
      </div>

      <nav
        className={`border-t border-border bg-sidebar ${
          keyboard && tab === "sessions" ? "hidden" : "flex"
        }`}
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              tab === id ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
            {id === "sessions" && sessionCount > 0 && (
              <span className="absolute right-[28%] top-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {sessionCount}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Hosts() {
  const servers = useVaultStore((s) => s.servers);
  const setShowServerForm = useUiStore((s) => s.setShowServerForm);
  const setEditingServerId = useUiStore((s) => s.setEditingServerId);
  const setTab = useMobileStore((s) => s.setTab);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return servers.filter(
      (s) =>
        !n ||
        s.name.toLowerCase().includes(n) ||
        s.host.toLowerCase().includes(n) ||
        s.username.toLowerCase().includes(n),
    );
  }, [servers, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search hosts"
            className="h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 text-base outline-none"
          />
        </div>
        <button
          aria-label="Add host"
          onClick={() => {
            setEditingServerId(null);
            setShowServerForm(true);
          }}
          className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {servers.length === 0
              ? "No hosts yet. Tap + to add one, or use More → Sync nearby to bring them from another device."
              : "No match."}
          </p>
        )}
        {list.map((s) => (
          <div
            key={s.id}
            className="flex items-center border-b border-border"
          >
            <button
              className="min-w-0 flex-1 px-4 py-3 text-left active:bg-accent"
              onClick={() => {
                connectServer(s);
                setTab("sessions");
              }}
            >
              <div className="truncate text-sm font-medium">{s.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {s.username ? `${s.username}@` : ""}
                {s.host}
                {s.port !== 22 ? `:${s.port}` : ""}
              </div>
            </button>
            <button
              className="px-4 py-3 text-xs text-muted-foreground"
              onClick={() => {
                setEditingServerId(s.id);
                setShowServerForm(true);
              }}
            >
              Edit
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sessions({ visible }: { visible: boolean }) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeSessionId);
  const setActive = useSessionStore((s) => s.setActiveSession);
  const remove = useSessionStore((s) => s.removeSession);
  const activeView = useUiStore((s) => s.activeView);
  const setActiveView = useUiStore((s) => s.setActiveView);
  const setTab = useMobileStore((s) => s.setTab);

  const top = sessions.filter((s) => !s.paneOf);
  const active = top.find((s) => s.id === activeId) ?? top[0];
  const [filesFor, setFilesFor] = useState<string | null>(null);

  useEffect(() => {
    if (activeView === "sftp" && active) {
      setFilesFor(active.id);
      setActiveView("terminal");
    }
  }, [activeView, active, setActiveView]);

  useEffect(() => {
    if (visible && top.length > 0 && activeView === "home") {
      setActiveView("terminal");
    }
  }, [visible, top.length, activeView, setActiveView]);

  if (top.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
        <TerminalIcon className="h-8 w-8 opacity-40" />
        No open sessions.
        <button
          className="rounded-md border border-border px-4 py-2 text-foreground"
          onClick={() => setTab("hosts")}
        >
          Pick a host
        </button>
      </div>
    );
  }

  const proto = (active?.kind ?? "ssh") as string;
  const canFiles = proto === "ssh" && !!active?.backendId;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-sidebar px-2 py-1.5">
        {top.map((s) => (
          <div
            key={s.id}
            className={`flex shrink-0 items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs ${
              s.id === active?.id
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            <button onClick={() => setActive(s.id)}>
              <span
                className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                  s.status === "connected"
                    ? "bg-green-500"
                    : s.status === "error"
                      ? "bg-red-500"
                      : "bg-yellow-500"
                }`}
              />
              {s.serverName}
            </button>
            <button aria-label="Close" onClick={() => remove(s.id)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {canFiles && (
          <button
            aria-label="Files"
            onClick={() => active && setFilesFor(active.id)}
            className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs"
          >
            <FolderTree className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <TerminalPage />
        {filesFor && active && filesFor === active.id && active.backendId && (
          <MobileFiles
            key={active.id}
            backendId={active.backendId}
            serverName={active.serverName}
            onClose={() => setFilesFor(null)}
          />
        )}
      </div>
      {active && activeView === "terminal" && !filesFor && (
        <KeyRow sessionId={active.id} />
      )}
    </div>
  );
}

function More() {
  const lockVault = useVaultStore((s) => s.lockVault);
  const activePanel = useUiStore((s) => s.activePanel);
  const setActivePanel = useUiStore((s) => s.setActivePanel);

  const current = MORE.find((m) => m.panel === activePanel);
  if (current) {
    const C = current.C;
    return (
      <div className="flex h-full flex-col">
        <button
          onClick={() => setActivePanel(null)}
          className="flex items-center gap-1 border-b border-border px-3 py-3 text-sm text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> {current.label}
        </button>
        <div className="min-h-0 flex-1">
          <C />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <KeepAliveRow />
      {MORE.map(({ panel, label, icon: Icon }) => (
        <button
          key={panel}
          onClick={() => setActivePanel(panel)}
          className="flex w-full items-center gap-3 border-b border-border px-4 py-4 text-left text-sm active:bg-accent"
        >
          <Icon className="h-5 w-5 text-muted-foreground" />
          {label}
        </button>
      ))}
      <button
        onClick={() => lockVault()}
        className="flex w-full items-center gap-3 px-4 py-4 text-left text-sm text-destructive active:bg-accent"
      >
        <Lock className="h-5 w-5" />
        Lock vault
      </button>
    </div>
  );
}

function KeepAliveRow() {
  const [on, setOn] = useState(getKeepAlive());
  return (
    <button
      onClick={() => {
        setKeepAlive(!on);
        setOn(!on);
      }}
      className="flex w-full items-center justify-between gap-3 border-b border-border px-4 py-4 text-left text-sm active:bg-accent"
    >
      <span>
        Keep sessions alive in background
        <span className="block text-xs text-muted-foreground">
          {isAndroid
            ? "Shows a notification while sessions are open."
            : "iOS only allows a short grace period after you leave the app."}
        </span>
      </span>
      <span
        className={`h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors ${
          on ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-background transition-transform ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}
