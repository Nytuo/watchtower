import React from "react";
import { useSessionStore, type Session } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { termKindClose } from "@/lib/tauri";
import { X, Terminal, Server, FolderTree } from "lucide-react";

export function TabBar() {
  const {
    sessions,
    activeSessionId,
    setActiveSession,
    removeSession,
    updateSession,
  } = useSessionStore();
  const { activeView, setActiveView } = useUiStore();
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");

  const handleSelectSession = (id: string) => {
    setActiveSession(id);
    if (activeView === "home") {
      const s = sessions.find((x) => x.id === id);
      setActiveView(s?.kind === "ftp" ? "ftp" : "terminal");
    }
  };

  const handleCloseTab = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (session.status === "connected") {
        await termKindClose(session.kind, session.backendId || session.id);
      }
    } catch {}
    removeSession(session.id);
  };

  return (
    <div className="flex items-center border-b border-border bg-background overflow-x-auto">
      <div
        className={`flex items-center gap-1.5 px-3 py-1.5 border-r border-border cursor-pointer text-sm transition-colors shrink-0 ${
          activeView === "home"
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50"
        }`}
        onClick={() => setActiveView("home")}
      >
        <Server className="h-3.5 w-3.5" />
        <span className="text-xs">Servers</span>
      </div>

      {sessions
        .filter((s) => !s.paneOf)
        .map((session) => (
        <div
          key={session.id}
          className={`group flex items-center gap-2 px-3 py-1.5 border-r border-border cursor-pointer text-sm min-w-0 max-w-[200px] transition-colors ${
            (activeView === "terminal" ||
              activeView === "sftp" ||
              activeView === "ftp") &&
            activeSessionId === session.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
          onClick={() => handleSelectSession(session.id)}
        >
          <div className="flex items-center gap-1">
            {session.kind === "ftp" ? (
              <button
                title="Files (FTP)"
                className={`p-0.5 rounded hover:bg-black/20 ${activeView === "ftp" && activeSessionId === session.id ? "text-foreground" : "text-muted-foreground"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveSession(session.id);
                  setActiveView("ftp");
                }}
              >
                <FolderTree className="h-3.5 w-3.5 shrink-0" />
              </button>
            ) : (
              <>
                <button
                  title="Terminal"
                  className={`p-0.5 rounded hover:bg-black/20 ${activeView === "terminal" && activeSessionId === session.id ? "text-foreground" : "text-muted-foreground"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSession(session.id);
                    setActiveView("terminal");
                  }}
                >
                  <Terminal className="h-3.5 w-3.5 shrink-0" />
                </button>
                <button
                  title="Files (SFTP)"
                  className={`p-0.5 rounded hover:bg-black/20 ${activeView === "sftp" && activeSessionId === session.id ? "text-foreground" : "text-muted-foreground"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSession(session.id);
                    setActiveView("sftp");
                  }}
                >
                  <FolderTree className="h-3.5 w-3.5 shrink-0" />
                </button>
              </>
            )}
          </div>
          {renaming === session.id ? (
            <input
              autoFocus
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                updateSession(session.id, { title: draft.trim() || undefined });
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateSession(session.id, {
                    title: draft.trim() || undefined,
                  });
                  setRenaming(null);
                }
                if (e.key === "Escape") setRenaming(null);
              }}
              className="w-24 bg-transparent text-xs outline-none ring-1 ring-border rounded px-1"
            />
          ) : (
            <span
              className="truncate text-xs"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setDraft(session.title ?? session.serverName);
                setRenaming(session.id);
              }}
            >
              {session.title ?? session.serverName}
            </span>
          )}
          {session.status === "connecting" && (
            <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse shrink-0" />
          )}
          {session.status === "error" && (
            <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
          )}
          <button
            className="ml-auto opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity shrink-0"
            onClick={(e) => handleCloseTab(session, e)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
