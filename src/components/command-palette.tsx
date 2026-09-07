import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "@/stores/ui-store";
import { useVaultStore } from "@/stores/vault-store";
import { useSessionStore } from "@/stores/session-store";
import { runSnippet } from "@/stores/snippet-run-store";
import { connectServer } from "@/lib/connect";
import { getOSIcon } from "@/components/icons/os-icons";
import { THEMES } from "@/lib/themes";
import { termKindClose } from "@/lib/tauri";
import {
  Terminal,
  Code2,
  Server,
  Settings,
  FolderOpen,
  Tags,
  KeyRound,
  ArrowRightLeft,
  Fingerprint,
  Lock,
  Plus,
  Radio,
  Palette,
  Keyboard,
  Zap,
} from "lucide-react";

type Cat = "action" | "server" | "snippet";
interface Item {
  cat: Cat;
  id: string;
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  run: () => void;
  keywords?: string;
}

function score(hay: string, needle: string): number {
  hay = hay.toLowerCase();
  needle = needle.toLowerCase();
  if (!needle) return 1;
  if (hay.includes(needle)) return 2 - needle.length / hay.length;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return 0.5;
  }
  return 0;
}

export function CommandPalette() {
  const { showCommandPalette, setShowCommandPalette } = useUiStore();
  const { snippets, servers } = useVaultStore();
  const { sessions, activeSessionId } = useSessionStore();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === "k" ||
          (e.shiftKey && e.key.toLowerCase() === "p"))
      ) {
        e.preventDefault();
        setShowCommandPalette(!useUiStore.getState().showCommandPalette);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowCommandPalette]);

  useEffect(() => {
    if (showCommandPalette) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [showCommandPalette]);

  const close = () => setShowCommandPalette(false);
  const ui = useUiStore.getState();

  const actions = useMemo<Item[]>(() => {
    const panel = (p: any, label: string, icon: Item["icon"]): Item => ({
      cat: "action",
      id: `panel-${p}`,
      title: label,
      subtitle: "Open panel",
      icon,
      run: () => {
        ui.setActivePanel(p);
        ui.setActiveView("home");
      },
    });
    const list: Item[] = [
      {
        cat: "action",
        id: "add-server",
        title: "Add server",
        subtitle: "Create a new server",
        icon: Plus,
        run: () => ui.setShowServerForm(true),
      },
      panel("groups", "Groups", FolderOpen),
      panel("tags", "Tags", Tags),
      panel("snippets", "Snippets", Code2),
      panel("keychains", "Keychain", KeyRound),
      panel("port-forwarding", "Tunnels", ArrowRightLeft),
      panel("known-hosts", "Known hosts", Fingerprint),
      panel("settings", "Settings", Settings),
      {
        cat: "action",
        id: "lock",
        title: "Lock vault",
        subtitle: "",
        icon: Lock,
        run: () => useVaultStore.getState().lockVault(),
      },
      {
        cat: "action",
        id: "broadcast",
        title: useUiStore.getState().broadcastInput
          ? "Disable broadcast input"
          : "Enable broadcast input",
        subtitle: "Type into every connected session",
        icon: Radio,
        run: () => ui.setBroadcastInput(!useUiStore.getState().broadcastInput),
      },
      {
        cat: "action",
        id: "shortcuts",
        title: "Keyboard shortcuts",
        subtitle: "",
        icon: Keyboard,
        run: () => ui.setShowShortcuts(true),
      },
      {
        cat: "action",
        id: "disconnect-all",
        title: "Disconnect all sessions",
        subtitle: "",
        icon: Zap,
        run: () => {
          for (const s of useSessionStore.getState().sessions) {
            if (s.backendId)
              termKindClose(s.kind, s.backendId).catch(() => {});
            useSessionStore.getState().removeSession(s.id);
          }
        },
      },
      ...Object.values(THEMES).map<Item>((t) => ({
        cat: "action",
        id: `theme-${t.key}`,
        title: `Theme: ${t.label}`,
        subtitle: "Switch theme",
        icon: Palette,
        keywords: "theme color",
        run: () => ui.setTheme(t.key),
      })),
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = useMemo<Item[]>(() => {
    const snip = [...snippets].sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.usage_count - a.usage_count,
    );
    const recentIds = [...servers]
      .filter((s) => s.last_connected)
      .sort((a, b) => Number(b.last_connected) - Number(a.last_connected))
      .slice(0, 5)
      .map((s) => s.id);

    const serverItems = [...servers]
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          recentIds.indexOf(a.id) - recentIds.indexOf(b.id),
      )
      .map<Item>((srv) => ({
        cat: "server",
        id: `srv-${srv.id}`,
        title: srv.name,
        subtitle: `${srv.username}@${srv.host}:${srv.port}${
          recentIds.includes(srv.id) ? "  · recent" : ""
        }`,
        icon: getOSIcon(srv.icon) as Item["icon"],
        run: () => connectServer(srv),
        keywords: `${srv.username}@${srv.host}`,
      }));

    const snippetItems = snip.map<Item>((s) => ({
      cat: "snippet",
      id: `snp-${s.id}`,
      title: s.name,
      subtitle: s.content.split("\n")[0].slice(0, 80),
      icon: Code2,
      run: () => runSnippet(s, { mode: "run" }),
      keywords: s.content,
    }));

    const all = [...serverItems, ...snippetItems, ...actions];
    if (!query) return all;
    return all
      .map((it) => ({
        it,
        s: Math.max(
          score(it.title, query),
          score(it.keywords ?? "", query) * 0.6,
          score(it.subtitle, query) * 0.4,
        ),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
  }, [snippets, servers, actions, query]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  if (!showCommandPalette) return null;

  const activate = (item: Item, paste = false) => {
    close();
    if (paste && item.cat === "snippet") {
      const s = snippets.find((x) => `snp-${x.id}` === item.id);
      if (s) runSnippet(s, { mode: "paste" });
      return;
    }
    item.run();
  };

  const hasSession = sessions.some(
    (s) => s.status === "connected" && s.backendId,
  );
  const activeName =
    sessions.find((s) => s.id === activeSessionId)?.serverName ?? "terminal";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]"
      onClick={close}
    >
      <div className="fixed inset-0 bg-black/60" />
      <div
        className="relative z-[61] w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && items[sel]) {
              e.preventDefault();
              activate(items[sel], e.shiftKey);
            } else if (e.key === "Escape") {
              close();
            }
          }}
          placeholder="Run a snippet, connect to a server, or an action…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nothing matches.
            </div>
          )}
          {items.slice(0, 60).map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => activate(item)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                  i === sel ? "bg-accent text-accent-foreground" : ""
                }`}
              >
                <Icon size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.subtitle}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                  {item.cat === "server" ? (
                    <Terminal className="h-3.5 w-3.5" />
                  ) : item.cat === "action" ? (
                    <Server className="h-3 w-3 opacity-40" />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
          {hasSession
            ? `↵ run in ${activeName}  ·  ⇧↵ paste snippet  ·  esc close`
            : "↵ select  ·  esc close"}
        </div>
      </div>
    </div>
  );
}
