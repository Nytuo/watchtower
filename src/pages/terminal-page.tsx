import { useEffect } from "react";
import { useSessionStore, type Session } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { TerminalView } from "@/components/terminal/terminal-view";
import { SftpView } from "@/components/vault/sftp-view";
import { FtpView } from "@/components/vault/ftp-view";
import { SnippetBar } from "@/components/snippet-bar";
import { ServerHomePage } from "@/pages/server-home-page";
import { connectServer } from "@/lib/connect";
import { useAdhocStore } from "@/stores/adhoc-store";
import type { ServerInfo } from "@/lib/tauri";

export function TerminalPage() {
  const { sessions, activeSessionId } = useSessionStore();
  const { servers } = useVaultStore();
  const { activeView, setActiveView } = useUiStore();
  const adhocConns = useAdhocStore((s) => s.conns);

  useEffect(() => {
    if (
      sessions.length === 0 &&
      (activeView === "terminal" ||
        activeView === "sftp" ||
        activeView === "ftp")
    ) {
      setActiveView("home");
    }
  }, [sessions.length, activeView, setActiveView]);

  if (activeView === "home") {
    return <ServerHomePage />;
  }

  return (
    <div className="flex h-full w-full flex-col">
      <SnippetBar />
      <div className="relative min-h-0 flex-1">
        {sessions
          .filter((s) => !s.paneOf)
          .map((session) => {
            const server =
              servers.find((s) => s.id === session.serverId) ??
              adhocConns[session.serverId]?.server;
            if (!server) return null;
            const pane = sessions.find((s) => s.paneOf === session.id);
            const paneServer = pane
              ? (servers.find((s) => s.id === pane.serverId) ??
                adhocConns[pane.serverId]?.server ??
                null)
              : null;

            return (
              <SessionView
                key={session.id}
                session={session}
                server={server}
                pane={pane ?? null}
                paneServer={paneServer}
                active={session.id === activeSessionId}
                activeView={activeView}
              />
            );
          })}
      </div>
    </div>
  );
}

function SessionView({
  session,
  server,
  pane,
  paneServer,
  active,
  activeView,
}: {
  session: Session;
  server: ServerInfo;
  pane: Session | null;
  paneServer: ServerInfo | null;
  active: boolean;
  activeView: string;
}) {
  const proto = (server.protocol || "ssh").toLowerCase();
  const isFtpProto = proto === "ftp" || proto === "ftps";
  const isTerminal = activeView === "terminal";
  const isSftp = activeView === "sftp";
  const isFtp = activeView === "ftp";
  const { removeSession, addSession, setActiveSession } = useSessionStore();

  const canSplit =
    !isFtpProto && isTerminal && !pane && proto !== "sftp";

  const doSplit = (dir: "h" | "v") => {
    const id = `pane-${session.id}-${Date.now()}`;
    addSession({
      id,
      serverId: session.serverId,
      serverName: session.serverName,
      host: session.host,
      status: "connecting",
      paneOf: session.id,
      splitDir: dir,
    });
    setActiveSession(session.id);
  };

  const splitDir = pane?.splitDir ?? "h";
  const showPane = pane && paneServer && isTerminal;

  return (
    <div className={active ? "relative h-full w-full" : "hidden"}>
      {session.status === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 text-center">
          <p className="text-sm font-medium text-destructive">
            {server.name} — connection failed
          </p>
          {session.error && (
            <p className="max-w-md px-6 text-xs text-muted-foreground">
              {session.error}
            </p>
          )}
          <button
            onClick={() => {
              removeSession(session.id);
              connectServer(server);
            }}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
          >
            Reconnect
          </button>
        </div>
      )}
      {/*
        TerminalView handles the SSH connection.
        It must be present for the session to stay alive and connected.
      */}
      {!isFtpProto && (
        <div
          className={
            isTerminal
              ? `flex h-full w-full ${splitDir === "v" ? "flex-col" : "flex-row"}`
              : "hidden"
          }
        >
          <div className="relative min-h-0 min-w-0 flex-1">
            <TerminalView
              sessionId={session.id}
              server={server}
              active={active && isTerminal}
              onSplit={canSplit ? doSplit : undefined}
            />
          </div>
          {showPane && (
            <>
              <div
                className={
                  splitDir === "v"
                    ? "h-px w-full bg-border"
                    : "h-full w-px bg-border"
                }
              />
              <div className="relative min-h-0 min-w-0 flex-1">
                <TerminalView
                  sessionId={pane!.id}
                  server={paneServer!}
                  active={active && isTerminal}
                  onClosePane={() => removeSession(pane!.id)}
                />
              </div>
            </>
          )}
        </div>
      )}

      {isSftp && !isFtpProto && (
        <SftpView
          sessionId={session.id}
          backendId={session.backendId}
          serverName={server.name}
          active={active && isSftp}
        />
      )}

      {isFtpProto && (
        <FtpView
          sessionId={session.id}
          serverId={server.id}
          serverName={server.name}
          secure={proto === "ftps"}
          active={active && isFtp}
        />
      )}
    </div>
  );
}
