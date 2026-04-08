import React from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { getOSIcon } from "@/components/icons/os-icons";
import type { ServerInfo } from "@/lib/tauri";
import { Server, Pencil, Trash2, Terminal, MoreVertical } from "lucide-react";

interface ServerListProps {
  onConnect?: (server: ServerInfo) => void;
}

export function ServerList({ onConnect }: ServerListProps) {
  const { servers, deleteServer } = useVaultStore();
  const { setEditingServerId, addToast } = useUiStore();
  const [contextMenu, setContextMenu] = React.useState<string | null>(null);

  const handleConnect = (server: ServerInfo) => {
    onConnect?.(server);
  };

  const handleDelete = async (server: ServerInfo) => {
    try {
      await deleteServer(server.id);
      addToast({
        title: "Server deleted",
        description: `${server.name} has been removed.`,
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

  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground">
        <Server className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No servers yet</p>
        <p className="text-xs mt-1">
          Click the + button to add your first server
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2">
      {servers.map((server) => (
        <div
          key={server.id}
          className="group relative flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent cursor-pointer transition-colors"
          onDoubleClick={() => handleConnect(server)}
        >
          <div
            className="h-8 w-1 rounded-full shrink-0"
            style={{
              backgroundColor: server.color || "hsl(0 0% 30%)",
            }}
          />

          {(() => {
            const OSIcon = getOSIcon(server.icon);
            return <OSIcon size={18} className="shrink-0" />;
          })()}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {server.name}
              </span>
              <span className="text-[10px] uppercase text-muted-foreground font-mono">
                {server.protocol}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {server.username}@{server.host}:{server.port}
            </div>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                handleConnect(server);
              }}
              title="Connect"
            >
              <Terminal className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(contextMenu === server.id ? null : server.id);
              }}
              title="More"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </div>

          {contextMenu === server.id && (
            <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-md border bg-popover py-1 shadow-md">
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent"
                onClick={() => {
                  setEditingServerId(server.id);
                  setContextMenu(null);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
                onClick={() => handleDelete(server)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
