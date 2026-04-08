import { useState, useMemo } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import { getOSIcon } from "@/components/icons/os-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronRight,
  Plus,
  Search,
  Terminal,
  Pencil,
  Trash2,
  MoreVertical,
} from "lucide-react";
import type { ServerInfo, ServerGroup } from "@/lib/tauri";

let sessionCounter = 0;

export function ServerHomePage() {
  const { servers, groups, tags, deleteServer } = useVaultStore();
  const { addSession, setActiveSession } = useSessionStore();
  const { setActiveView, setShowServerForm, setEditingServerId, addToast } =
    useUiStore();

  const [search, setSearch] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [contextMenu, setContextMenu] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return servers.filter((s) => {
      if (
        q &&
        !s.name.toLowerCase().includes(q) &&
        !s.host.toLowerCase().includes(q)
      )
        return false;
      if (selectedTagIds.size > 0 && !s.tags.some((t) => selectedTagIds.has(t)))
        return false;
      return true;
    });
  }, [servers, search, selectedTagIds]);

  const handleConnect = (server: ServerInfo) => {
    const id = `session-${server.id}-${Date.now()}-${++sessionCounter}`;
    addSession({
      id,
      serverId: server.id,
      serverName: server.name,
      host: server.host,
      status: "connecting",
    });
    setActiveSession(id);
    setActiveView(server.protocol === "sftp" ? "sftp" : "terminal");
  };

  const handleDelete = async (server: ServerInfo) => {
    try {
      await deleteServer(server.id);
      addToast({
        title: "Server deleted",
        description: `${server.name} removed.`,
      });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
    setContextMenu(null);
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const groupedServers = useMemo(() => {
    const map = new Map<string | null, ServerInfo[]>();
    map.set(null, []);
    for (const g of groups) map.set(g.id, []);
    for (const s of filtered) {
      const key = s.group_id && map.has(s.group_id) ? s.group_id : null;
      map.get(key)!.push(s);
    }
    return map;
  }, [filtered, groups]);

  const visibleGroups = groups.filter(
    (g) => (groupedServers.get(g.id)?.length ?? 0) > 0,
  );
  const ungrouped = groupedServers.get(null) ?? [];

  if (servers.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <Terminal className="h-12 w-12 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">No servers yet</p>
          <p className="text-xs mt-1">Add a server to get started</p>
        </div>
        <Button size="sm" onClick={() => setShowServerForm(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Server
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      onClick={() => setContextMenu(null)}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search servers…"
            className="pl-8 h-8 text-sm"
          />
        </div>
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

      {tags.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-2 scrollbar-none">
          {tags.map((tag) => {
            const active = selectedTagIds.has(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={[
                  "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-transparent text-white"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
                ].join(" ")}
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

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No servers match your filter.
          </p>
        ) : (
          <>
            {visibleGroups.map((group) => (
              <GroupSection
                key={group.id}
                group={group}
                servers={groupedServers.get(group.id) ?? []}
                collapsed={collapsedGroups.has(group.id)}
                onToggle={() => toggleGroup(group.id)}
                tags={tags}
                contextMenu={contextMenu}
                setContextMenu={setContextMenu}
                onConnect={handleConnect}
                onEdit={(s) => setEditingServerId(s.id)}
                onDelete={handleDelete}
              />
            ))}

            {ungrouped.length > 0 && (
              <GroupSection
                group={null}
                servers={ungrouped}
                collapsed={collapsedGroups.has("__ungrouped__")}
                onToggle={() => toggleGroup("__ungrouped__")}
                tags={tags}
                contextMenu={contextMenu}
                setContextMenu={setContextMenu}
                onConnect={handleConnect}
                onEdit={(s) => setEditingServerId(s.id)}
                onDelete={handleDelete}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function GroupSection({
  group,
  servers,
  collapsed,
  onToggle,
  tags,
  contextMenu,
  setContextMenu,
  onConnect,
  onEdit,
  onDelete,
}: {
  group: ServerGroup | null;
  servers: ServerInfo[];
  collapsed: boolean;
  onToggle: () => void;
  tags: import("@/lib/tauri").Tag[];
  contextMenu: string | null;
  setContextMenu: (id: string | null) => void;
  onConnect: (s: ServerInfo) => void;
  onEdit: (s: ServerInfo) => void;
  onDelete: (s: ServerInfo) => Promise<void>;
}) {
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        onClick={onToggle}
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        {group ? (
          <>
            {group.color && (
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: group.color }}
              />
            )}
            {group.name}
          </>
        ) : (
          "Ungrouped"
        )}
        <span className="ml-auto font-normal normal-case tracking-normal text-muted-foreground/60">
          {servers.length}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {servers.map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              tags={tags}
              contextMenu={contextMenu}
              setContextMenu={setContextMenu}
              onConnect={onConnect}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerCard({
  server,
  tags,
  contextMenu,
  setContextMenu,
  onConnect,
  onEdit,
  onDelete,
}: {
  server: ServerInfo;
  tags: import("@/lib/tauri").Tag[];
  contextMenu: string | null;
  setContextMenu: (id: string | null) => void;
  onConnect: (s: ServerInfo) => void;
  onEdit: (s: ServerInfo) => void;
  onDelete: (s: ServerInfo) => Promise<void>;
}) {
  const OSIcon = getOSIcon(server.icon);
  const serverTags = tags.filter((t) => server.tags.includes(t.id));

  return (
    <div
      className="group relative flex flex-col gap-2 rounded-lg border border-border bg-card p-3 hover:border-border/80 hover:bg-accent/30 transition-colors cursor-pointer"
      onDoubleClick={() => onConnect(server)}
      onClick={(e) => e.stopPropagation()}
    >
      {server.color && (
        <div
          className="absolute left-0 top-0 h-full w-1 rounded-l-lg"
          style={{ backgroundColor: server.color }}
        />
      )}

      <div className="flex items-start gap-2 pl-1">
        <OSIcon size={20} className="shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{server.name}</span>
            <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-mono uppercase text-muted-foreground">
              {server.protocol}
            </span>
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {server.username}@{server.host}:{server.port}
          </div>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
      </div>

      {serverTags.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1">
          {serverTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-2 py-px text-[10px] font-medium text-white"
              style={{
                backgroundColor: tag.color ?? "hsl(var(--muted-foreground))",
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {contextMenu === server.id && (
        <div
          className="absolute right-1 top-8 z-50 w-36 rounded-md border bg-popover py-1 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
            onClick={() => {
              onEdit(server);
              setContextMenu(null);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
            onClick={() => onDelete(server)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
