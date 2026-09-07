import type React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { getOSIcon } from "@/components/icons/os-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { connectServer, connectAdhoc } from "@/lib/connect";
import { confirmDialog } from "@/stores/dialog-store";
import { parseTarget } from "@/stores/adhoc-store";
import {
  ChevronRight,
  Plus,
  Search,
  Terminal,
  Pencil,
  Trash2,
  MoreVertical,
  Star,
  Copy,
  CheckSquare,
  Zap,
  ClipboardCopy,
} from "lucide-react";

function sshCommand(s: ServerInfo): string {
  const parts = ["ssh"];
  if (s.port !== 22) parts.push("-p", String(s.port));
  const jh = s.advanced?.jump_hosts ?? [];
  if (jh.length) {
    parts.push(
      "-J",
      jh.map((j) => `${j.username}@${j.host}:${j.port}`).join(","),
    );
  }
  if (s.advanced?.compression) parts.push("-C");
  if (s.auth_type === "key_file" && s.advanced) {
    // path not exposed on ServerInfo auth; skip -i
  }
  parts.push(`${s.username}@${s.host}`);
  return parts.join(" ");
}
import type { ServerInfo, ServerGroup, Tag } from "@/lib/tauri";

function ago(sec: string | null): string {
  if (!sec) return "";
  const d = Date.now() / 1000 - Number(sec);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function ServerHomePage() {
  const {
    servers,
    groups,
    tags,
    deleteServer,
    duplicateServer,
    updateServer,
    bulkUpdateServers,
    reorderServers,
    settings,
  } = useVaultStore();
  const dragIdRef = useRef<string | null>(null);
  const sessions = useSessionStore((s) => s.sessions);
  const { setShowServerForm, setEditingServerId, addToast } = useUiStore();

  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quick, setQuick] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const liveServerIds = useMemo(
    () =>
      new Set(
        sessions.filter((s) => s.status === "connected").map((s) => s.serverId),
      ),
    [sessions],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.host.toLowerCase().includes(q) &&
        !s.username.toLowerCase().includes(q)
      )
        return false;
      if (selectedTagIds.size > 0 && !s.tags.some((t) => selectedTagIds.has(t)))
        return false;
      return true;
    });
  }, [servers, search, selectedTagIds]);

  const noFilter = !search.trim() && selectedTagIds.size === 0;

  const pinned = useMemo(() => filtered.filter((s) => s.pinned), [filtered]);
  const recents = useMemo(
    () =>
      noFilter
        ? [...servers]
            .filter((s) => s.last_connected && !s.pinned)
            .sort((a, b) => Number(b.last_connected) - Number(a.last_connected))
            .slice(0, 6)
        : [],
    [servers, noFilter],
  );

  // Nested group tree
  const childGroups = useMemo(() => {
    const m = new Map<string | null, ServerGroup[]>();
    for (const g of groups) {
      const p = g.parent_id ?? null;
      if (!m.has(p)) m.set(p, []);
      m.get(p)!.push(g);
    }
    for (const v of m.values()) v.sort((a, b) => a.order - b.order);
    return m;
  }, [groups]);

  const serversByGroup = useMemo(() => {
    const m = new Map<string | null, ServerInfo[]>();
    const groupIds = new Set(groups.map((g) => g.id));
    for (const s of filtered) {
      const key = s.group_id && groupIds.has(s.group_id) ? s.group_id : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    for (const v of m.values())
      v.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return m;
  }, [filtered, groups]);

  const countInTree = (gid: string): number => {
    let n = serversByGroup.get(gid)?.length ?? 0;
    for (const c of childGroups.get(gid) ?? []) n += countInTree(c.id);
    return n;
  };

  const doConnect = (s: ServerInfo) => {
    if (selectMode) return toggleSel(s.id);
    connectServer(s);
  };

  const doDelete = async (s: ServerInfo) => {
    setContextMenu(null);
    if (settings?.confirm_on_delete !== false) {
      const ok = await confirmDialog({
        title: `Delete "${s.name}"?`,
        message: "This removes the server and its saved credentials.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await deleteServer(s.id);
      addToast({ title: "Server deleted", description: s.name });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const doDuplicate = async (s: ServerInfo) => {
    setContextMenu(null);
    try {
      await duplicateServer(s.id);
      addToast({ title: "Duplicated", description: `${s.name} (copy)` });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const togglePin = async (s: ServerInfo) => {
    setContextMenu(null);
    try {
      await updateServer({ id: s.id, pinned: !s.pinned });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const toggleSel = (id: string) =>
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const bulkDelete = async () => {
    const ok = await confirmDialog({
      title: `Delete ${selected.size} servers?`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await bulkUpdateServers({ ids: [...selected], delete: true });
    setSelected(new Set());
    setSelectMode(false);
  };

  const bulkMove = async (groupId: string) => {
    await bulkUpdateServers({
      ids: [...selected],
      groupId: groupId === "__none__" ? "" : groupId,
    });
    setSelected(new Set());
  };

  const bulkTag = async (tagId: string, add: boolean) => {
    await bulkUpdateServers({
      ids: [...selected],
      addTags: add ? [tagId] : undefined,
      removeTags: add ? undefined : [tagId],
    });
    setSelected(new Set());
  };

  const runQuick = () => {
    const t = parseTarget(quick);
    if (!t) {
      addToast({ title: "Enter user@host[:port]", variant: "destructive" });
      return;
    }
    connectAdhoc({ ...t, authType: "agent" });
    setQuick("");
  };

  const toggleTag = (id: string) =>
    setSelectedTagIds((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleCollapse = (id: string) =>
    setCollapsed((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (servers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <Terminal className="h-12 w-12 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No servers yet</p>
          <p className="mt-1 text-xs">Add a server or quick-connect below</p>
        </div>
        <div className="flex w-72 items-center gap-1.5">
          <Input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuick()}
            placeholder="root@host:22"
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8" onClick={runQuick}>
            <Zap className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowServerForm(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>
    );
  }

  const onReorderDrop = (target: ServerInfo) => {
    const from = dragIdRef.current;
    dragIdRef.current = null;
    if (!from || from === target.id) return;
    const groupIds = new Set(groups.map((g) => g.id));
    const key =
      target.group_id && groupIds.has(target.group_id) ? target.group_id : null;
    const list = servers
      .filter(
        (s) =>
          (s.group_id && groupIds.has(s.group_id) ? s.group_id : null) === key,
      )
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const fromIdx = list.findIndex((s) => s.id === from);
    const toIdx = list.findIndex((s) => s.id === target.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    reorderServers(list.map((s) => s.id));
  };

  const cardProps = {
    tags,
    onDragStartCard: (id: string) => {
      dragIdRef.current = id;
    },
    onDropCard: onReorderDrop,
    draggableCards: !selectMode,
    contextMenu,
    setContextMenu,
    selectMode,
    selected,
    liveServerIds,
    onConnect: doConnect,
    onEdit: (s: ServerInfo) => setEditingServerId(s.id),
    onDelete: doDelete,
    onDuplicate: doDuplicate,
    onTogglePin: togglePin,
    focusedId,
    setFocusedId,
  };

  const renderGroup = (g: ServerGroup, depth: number) => {
    const own = serversByGroup.get(g.id) ?? [];
    const kids = childGroups.get(g.id) ?? [];
    const total = countInTree(g.id);
    if (total === 0) return null;
    const isCollapsed = collapsed.has(g.id);
    return (
      <div key={g.id} style={{ marginLeft: depth * 12 }}>
        <div className="group flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <button
            className="flex flex-1 items-center gap-1.5 hover:text-foreground"
            onClick={() => toggleCollapse(g.id)}
          >
            <ChevronRight
              className={`h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
            />
            {g.color && (
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: g.color }}
              />
            )}
            {g.name}
          </button>
          <button
            title="Add subgroup"
            className="opacity-0 hover:text-foreground group-hover:opacity-100"
            onClick={() => {
              useUiStore.getState().setNewGroupParent(g.id);
              useUiStore.getState().setActivePanel("groups");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
            {total}
          </span>
        </div>
        {!isCollapsed && (
          <>
            {own.length > 0 && (
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {own.map((s) => (
                  <ServerCard key={s.id} server={s} {...cardProps} />
                ))}
              </div>
            )}
            {kids.map((c) => renderGroup(c, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const ungrouped = serversByGroup.get(null) ?? [];
  const rootGroups = childGroups.get(null) ?? [];

  const flatVisible: ServerInfo[] = (() => {
    const out: ServerInfo[] = [...pinned, ...recents];
    const walk = (g: ServerGroup) => {
      if (countInTree(g.id) === 0) return;
      out.push(...(serversByGroup.get(g.id) ?? []));
      if (!collapsed.has(g.id))
        for (const c of childGroups.get(g.id) ?? []) walk(c);
    };
    for (const g of rootGroups) walk(g);
    out.push(...ungrouped);
    return out;
  })();

  const onListKey = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "e"].includes(e.key)) return;
    const ids = flatVisible.map((s) => s.id);
    if (ids.length === 0) return;
    const cur = focusedId ? ids.indexOf(focusedId) : -1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedId(ids[Math.min(cur + 1, ids.length - 1)] ?? ids[0]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedId(ids[Math.max(cur - 1, 0)] ?? ids[0]);
    } else if (e.key === "Enter" && focusedId) {
      const s = flatVisible.find((x) => x.id === focusedId);
      if (s) doConnect(s);
    } else if (e.key === "e" && focusedId) {
      setEditingServerId(focusedId);
    }
  };

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onClick={() => setContextMenu(null)}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search servers…"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="relative w-52">
          <Zap className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runQuick()}
            placeholder="quick: user@host:port"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant={selectMode ? "default" : "outline"}
          className="h-8 gap-1.5"
          onClick={() => {
            setSelectMode((v) => !v);
            setSelected(new Set());
          }}
        >
          <CheckSquare className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => setShowServerForm(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      {selectMode && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/40 px-4 py-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          {groups.length > 0 && (
            <Select
              className="h-7 w-40 text-xs"
              value=""
              onChange={(e) => e.target.value && bulkMove(e.target.value)}
              options={[
                { value: "", label: "Move to group…" },
                { value: "__none__", label: "Ungrouped" },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
          )}
          {tags.length > 0 && (
            <Select
              className="h-7 w-32 text-xs"
              value=""
              onChange={(e) => e.target.value && bulkTag(e.target.value, true)}
              options={[
                { value: "", label: "Add tag…" },
                ...tags.map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          )}
          <Button
            size="sm"
            variant="destructive"
            className="h-7"
            onClick={bulkDelete}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2">
          {tags.map((tag) => {
            const active = selectedTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-transparent text-white"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
                style={
                  active && tag.color
                    ? { backgroundColor: tag.color, borderColor: tag.color }
                    : {}
                }
              >
                {tag.name}
              </button>
            );
          })}
          {selectedTagIds.size > 0 && (
            <button
              onClick={() => setSelectedTagIds(new Set())}
              className="shrink-0 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div
        className="flex-1 space-y-5 overflow-y-auto px-4 py-3 outline-none"
        tabIndex={0}
        role="listbox"
        aria-label="Servers"
        onKeyDown={onListKey}
      >
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No servers match your filter.
          </p>
        )}

        {pinned.length > 0 && (
          <Section label="Favourites">
            {pinned.map((s) => (
              <ServerCard key={s.id} server={s} {...cardProps} />
            ))}
          </Section>
        )}

        {recents.length > 0 && (
          <Section label="Recent">
            {recents.map((s) => (
              <ServerCard key={`r-${s.id}`} server={s} {...cardProps} />
            ))}
          </Section>
        )}

        {rootGroups.map((g) => renderGroup(g, 0))}

        {ungrouped.length > 0 && (
          <Section label="Ungrouped">
            {ungrouped.map((s) => (
              <ServerCard key={s.id} server={s} {...cardProps} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  server: ServerInfo;
  tags: Tag[];
  contextMenu: string | null;
  setContextMenu: (id: string | null) => void;
  selectMode: boolean;
  selected: Set<string>;
  liveServerIds: Set<string>;
  onConnect: (s: ServerInfo) => void;
  onEdit: (s: ServerInfo) => void;
  onDelete: (s: ServerInfo) => void;
  onDuplicate: (s: ServerInfo) => void;
  onTogglePin: (s: ServerInfo) => void;
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
  onDragStartCard: (id: string) => void;
  onDropCard: (s: ServerInfo) => void;
  draggableCards: boolean;
}

function ServerCard({
  server,
  tags,
  contextMenu,
  setContextMenu,
  selectMode,
  selected,
  liveServerIds,
  onConnect,
  onEdit,
  onDelete,
  onDuplicate,
  onTogglePin,
  focusedId,
  setFocusedId,
  onDragStartCard,
  onDropCard,
  draggableCards,
}: CardProps) {
  const [dragOver, setDragOver] = useState(false);
  const OSIcon = getOSIcon(server.icon);
  const serverTags = tags.filter((t) => server.tags.includes(t.id));
  const live = liveServerIds.has(server.id);
  const isSel = selected.has(server.id);
  const isFocused = focusedId === server.id;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused) ref.current?.scrollIntoView({ block: "nearest" });
  }, [isFocused]);

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={isSel || isFocused}
      aria-label={`${server.name}, ${server.username}@${server.host}`}
      draggable={draggableCards}
      onDragStart={(e) => {
        onDragStartCard(server.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!draggableCards) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onDropCard(server);
      }}
      className={`group relative flex cursor-pointer flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-accent/30 ${
        dragOver
          ? "border-primary ring-1 ring-primary"
          : isSel
            ? "border-primary"
            : isFocused
              ? "border-ring ring-1 ring-ring"
              : "border-border hover:border-border/80"
      }`}
      onDoubleClick={() => onConnect(server)}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedId(server.id);
        if (selectMode) onConnect(server);
      }}
    >
      {server.color && (
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l-lg"
          style={{ backgroundColor: server.color }}
        />
      )}

      <div className="flex items-start gap-2 pl-1">
        {selectMode && (
          <input
            type="checkbox"
            checked={isSel}
            readOnly
            className="mt-1 rounded border-border"
          />
        )}
        <div className="relative shrink-0">
          <OSIcon size={20} className="mt-0.5" />
          {live && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-green-500 ring-2 ring-card" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {server.pinned && (
              <Star className="h-3 w-3 shrink-0 fill-yellow-500 text-yellow-500" />
            )}
            <span className="truncate text-sm font-medium">{server.name}</span>
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-mono uppercase text-muted-foreground">
              {server.protocol}
            </span>
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {server.username}@{server.host}:{server.port}
            {server.last_connected && (
              <span className="ml-1 opacity-60">
                · {ago(server.last_connected)}
              </span>
            )}
          </div>
        </div>

        {!selectMode && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Connect"
              onClick={(e) => {
                e.stopPropagation();
                onConnect(server);
              }}
            >
              <Terminal className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="More"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(contextMenu === server.id ? null : server.id);
              }}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {serverTags.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1">
          {serverTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-2 py-px text-[10px] font-medium text-white"
              style={{ backgroundColor: tag.color ?? "#71717a" }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {contextMenu === server.id && (
        <div
          className="absolute right-1 top-8 z-50 w-40 rounded-md border bg-popover py-1 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="Edit"
            onClick={() => {
              onEdit(server);
              setContextMenu(null);
            }}
          />
          <MenuItem
            icon={<Star className="h-3.5 w-3.5" />}
            label={server.pinned ? "Unpin" : "Pin to favourites"}
            onClick={() => onTogglePin(server)}
          />
          <MenuItem
            icon={<Copy className="h-3.5 w-3.5" />}
            label="Duplicate"
            onClick={() => onDuplicate(server)}
          />
          <MenuItem
            icon={<ClipboardCopy className="h-3.5 w-3.5" />}
            label="Copy ssh command"
            onClick={() => {
              navigator.clipboard.writeText(sshCommand(server)).catch(() => {});
              setContextMenu(null);
            }}
          />
          <div className="my-1 h-px bg-border" />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Delete"
            danger
            onClick={() => onDelete(server)}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent ${
        danger ? "text-destructive" : ""
      }`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
