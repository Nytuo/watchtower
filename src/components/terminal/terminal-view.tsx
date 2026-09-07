import { useEffect, useRef, useState } from "react";
import { useTerminal } from "@/hooks/use-terminal";
import { useUiStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { sshStartLog, sshStopLog } from "@/lib/tauri";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Eraser,
  ZoomIn,
  ZoomOut,
  Radio,
  FileText,
  SplitSquareHorizontal,
  SplitSquareVertical,
} from "lucide-react";
import type { ServerInfo } from "@/lib/tauri";

interface TerminalViewProps {
  sessionId: string;
  server: ServerInfo;
  active: boolean;
  onSplit?: (dir: "h" | "v") => void;
  onClosePane?: () => void;
}

export function TerminalView({
  sessionId,
  server,
  active,
  onSplit,
  onClosePane,
}: TerminalViewProps) {
  const { containerRef, safeFit, searchAddonRef, clearBuffer, zoom } =
    useTerminal({ sessionId, server });
  const prevActiveRef = useRef(active);
  const { broadcastInput, setBroadcastInput } = useUiStore();
  const backendId = useSessionStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.backendId,
  );

  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [logging, setLogging] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const toggleLog = async () => {
    if (!backendId) return;
    if (logging) {
      await sshStopLog(backendId).catch(() => {});
      setLogging(false);
      return;
    }
    const p = await saveDialog({
      defaultPath: `${server.name.replace(/\s+/g, "-")}-${Date.now()}.log`,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
    });
    if (!p) return;
    try {
      await sshStartLog(backendId, p);
      setLogging(true);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (active && !prevActiveRef.current) {
      requestAnimationFrame(() => safeFit());
    }
    prevActiveRef.current = active;
  }, [active, safeFit]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setShowSearch(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        searchAddonRef.current?.clearDecorations();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, showSearch, searchAddonRef]);

  const find = (dir: "next" | "prev") => {
    const s = searchAddonRef.current;
    if (!s || !query) return;
    if (dir === "next") s.findNext(query);
    else s.findPrevious(query);
  };

  return (
    <div
      className="relative h-full w-full"
      style={
        active
          ? { padding: 0 }
          : {
              padding: 0,
              visibility: "hidden",
              position: "absolute",
              top: 0,
              left: 0,
            }
      }
    >
      {active && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100">
          {onSplit && (
            <>
              <button
                title="Split right"
                onClick={() => onSplit("h")}
                className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
              >
                <SplitSquareHorizontal className="h-3.5 w-3.5" />
              </button>
              <button
                title="Split down"
                onClick={() => onSplit("v")}
                className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
              >
                <SplitSquareVertical className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {onClosePane && (
            <button
              title="Close pane"
              onClick={onClosePane}
              className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            title={
              broadcastInput
                ? "Broadcast ON"
                : "Broadcast input to all sessions"
            }
            onClick={() => setBroadcastInput(!broadcastInput)}
            className={`rounded border p-1 ${
              broadcastInput
                ? "border-yellow-500 bg-yellow-500/20 text-yellow-500"
                : "border-border bg-background/80 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Radio className="h-3.5 w-3.5" />
          </button>
          <button
            title="Zoom out (Ctrl -)"
            onClick={() => zoom("out")}
            className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            title="Zoom in (Ctrl +)"
            onClick={() => zoom("in")}
            className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            title="Clear scrollback"
            onClick={clearBuffer}
            className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
          <button
            title={logging ? "Stop logging to file" : "Log session to file"}
            onClick={toggleLog}
            className={`rounded border p-1 ${
              logging
                ? "border-red-500 bg-red-500/20 text-red-500"
                : "border-border bg-background/80 text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          <button
            title="Search (Ctrl F)"
            onClick={() => {
              setShowSearch(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
            className="rounded border border-border bg-background/80 p-1 text-muted-foreground hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {active && showSearch && (
        <div className="absolute right-2 top-11 z-20 flex items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-lg">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              const s = searchAddonRef.current;
              if (s && e.target.value) s.findNext(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") setShowSearch(false);
            }}
            placeholder="Find in terminal…"
            className="w-48 bg-transparent px-1.5 py-0.5 text-xs outline-none"
          />
          <button
            className="p-1 text-muted-foreground hover:text-foreground"
            onClick={() => find("prev")}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1 text-muted-foreground hover:text-foreground"
            onClick={() => find("next")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setShowSearch(false);
              searchAddonRef.current?.clearDecorations();
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {broadcastInput && active && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 bg-yellow-500" />
      )}

      <div className="h-full w-full" ref={containerRef} />
    </div>
  );
}
