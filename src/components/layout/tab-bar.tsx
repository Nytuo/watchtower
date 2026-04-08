import React from "react";
import { useSessionStore, type Session } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { sshDisconnect } from "@/lib/tauri";
import { X, Terminal, Server, FolderTree } from "lucide-react";

export function TabBar() {
  const { sessions, activeSessionId, setActiveSession, removeSession } =
    useSessionStore();
  const { activeView, setActiveView } = useUiStore();

  const handleSelectSession = (id: string) => {
    setActiveSession(id);
    if (activeView === "home") {
      setActiveView("terminal");
    }
  };

  const handleCloseTab = async (session: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (session.status === "connected") {
        await sshDisconnect(session.id);
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

      {sessions.map((session) => (
        <div
          key={session.id}
          className={`group flex items-center gap-2 px-3 py-1.5 border-r border-border cursor-pointer text-sm min-w-0 max-w-[200px] transition-colors ${
            (activeView === "terminal" || activeView === "sftp") &&
            activeSessionId === session.id
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50"
          }`}
          onClick={() => handleSelectSession(session.id)}
        >
          <div className="flex items-center gap-1">
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
          </div>
          <span className="truncate text-xs">{session.serverName}</span>
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
