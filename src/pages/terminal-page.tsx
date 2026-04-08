import { useEffect } from "react";
import { useSessionStore, type Session } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { TerminalView } from "@/components/terminal/terminal-view";
import { SftpView } from "@/components/vault/sftp-view";
import { ServerHomePage } from "@/pages/server-home-page";
import type { ServerInfo } from "@/lib/tauri";

export function TerminalPage() {
  const { sessions, activeSessionId } = useSessionStore();
  const { servers } = useVaultStore();
  const { activeView, setActiveView } = useUiStore();

  useEffect(() => {
    if (
      sessions.length === 0 &&
      (activeView === "terminal" || activeView === "sftp")
    ) {
      setActiveView("home");
    }
  }, [sessions.length, activeView, setActiveView]);

  if (activeView === "home") {
    return <ServerHomePage />;
  }

  return (
    <div className="h-full w-full relative">
      {sessions.map((session) => {
        const server = servers.find((s) => s.id === session.serverId);
        if (!server) return null;

        return (
          <SessionView
            key={session.id}
            session={session}
            server={server}
            active={session.id === activeSessionId}
            activeView={activeView}
          />
        );
      })}
    </div>
  );
}

function SessionView({
  session,
  server,
  active,
  activeView,
}: {
  session: Session;
  server: ServerInfo;
  active: boolean;
  activeView: string;
}) {
  const isTerminal = activeView === "terminal";
  const isSftp = activeView === "sftp";

  return (
    <div className={active ? "h-full w-full" : "hidden"}>
      {/* 
        TerminalView handles the SSH connection. 
        It must be present for the session to stay alive and connected.
      */}
      <div className={isTerminal ? "h-full w-full" : "hidden"}>
        <TerminalView
          sessionId={session.id}
          server={server}
          active={active && isTerminal}
        />
      </div>

      {isSftp && (
        <SftpView
          sessionId={session.id}
          backendId={session.backendId}
          serverName={server.name}
          active={active && isSftp}
        />
      )}
    </div>
  );
}
