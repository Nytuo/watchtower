import { useState, useEffect, useCallback, useRef } from "react";
import {
  ftpConnectServer,
  ftpDisconnect,
  ftpList,
  ftpMkdir,
  ftpDelete,
  ftpRename,
  ftpDownload,
  ftpUpload,
  type FtpEntry,
} from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { promptDialog, confirmDialog } from "@/stores/dialog-store";
import {
  ArrowUp,
  RefreshCw,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  Pencil,
  Folder,
  File as FileIcon,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { downloadDir, join, basename } from "@tauri-apps/api/path";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

interface Props {
  sessionId: string;
  serverId: string;
  serverName: string;
  secure: boolean;
  active: boolean;
}

export function FtpView({
  sessionId,
  serverId,
  serverName,
  secure,
  active,
}: Props) {
  const { addToast } = useUiStore();
  const [connId, setConnId] = useState<string | null>(null);
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<FtpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const connRef = useRef<string | null>(null);

  const refresh = useCallback(
    async (id: string, path: string) => {
      setLoading(true);
      setError(null);
      try {
        const list = await ftpList(id, path);
        setEntries(list);
        setCwd(path);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const id = await ftpConnectServer(serverId, secure);
        if (cancelled) {
          ftpDisconnect(id).catch(() => {});
          return;
        }
        connRef.current = id;
        setConnId(id);
        useSessionStore
          .getState()
          .updateSession(sessionId, {
            status: "connected",
            backendId: id,
            kind: "ftp",
          });
        await refresh(id, "/");
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          useSessionStore
            .getState()
            .updateSession(sessionId, { status: "error", error: String(e) });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (connRef.current) {
        ftpDisconnect(connRef.current).catch(() => {});
        connRef.current = null;
      }
    };
  }, [serverId, secure, refresh, sessionId]);

  const go = (path: string) => {
    if (connId) refresh(connId, path || "/");
  };

  const parent = () => {
    const p = cwd.replace(/\/+$/, "");
    const up = p.slice(0, p.lastIndexOf("/")) || "/";
    go(up);
  };

  const onOpen = (f: FtpEntry) => {
    if (f.is_dir) go(f.path);
  };

  const onMkdir = async () => {
    if (!connId) return;
    const name = await promptDialog({ title: "New folder" });
    if (!name) return;
    try {
      await ftpMkdir(connId, `${cwd.replace(/\/+$/, "")}/${name}`);
      refresh(connId, cwd);
    } catch (e) {
      addToast({ title: "mkdir failed", description: String(e), variant: "destructive" });
    }
  };

  const onRename = async (f: FtpEntry) => {
    if (!connId) return;
    const name = await promptDialog({ title: "Rename", defaultValue: f.name });
    if (!name || name === f.name) return;
    try {
      await ftpRename(connId, f.path, `${cwd.replace(/\/+$/, "")}/${name}`);
      refresh(connId, cwd);
    } catch (e) {
      addToast({ title: "Rename failed", description: String(e), variant: "destructive" });
    }
  };

  const onDelete = async (f: FtpEntry) => {
    if (!connId) return;
    const ok = await confirmDialog({
      title: `Delete ${f.name}?`,
      message: f.is_dir ? "The folder must be empty." : "This cannot be undone.",
      danger: true,
    });
    if (!ok) return;
    try {
      await ftpDelete(connId, f.path, f.is_dir);
      refresh(connId, cwd);
    } catch (e) {
      addToast({ title: "Delete failed", description: String(e), variant: "destructive" });
    }
  };

  const onDownload = async (f: FtpEntry) => {
    if (!connId || f.is_dir) return;
    const dest = await saveDialog({
      defaultPath: await join(await downloadDir(), f.name),
    });
    if (!dest) return;
    try {
      await ftpDownload(connId, f.path, dest);
      addToast({ title: "Downloaded", description: f.name });
    } catch (e) {
      addToast({ title: "Download failed", description: String(e), variant: "destructive" });
    }
  };

  const onUpload = async () => {
    if (!connId) return;
    const sel = await openDialog({ multiple: true, title: "Upload files" });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    for (const p of paths) {
      try {
        const name = await basename(p);
        await ftpUpload(connId, p, `${cwd.replace(/\/+$/, "")}/${name}`);
      } catch (e) {
        addToast({ title: "Upload failed", description: String(e), variant: "destructive" });
      }
    }
    refresh(connId, cwd);
  };

  if (!active) return null;

  return (
    <div className="flex h-full w-full flex-col bg-background text-sm">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <span className="mr-2 text-xs text-muted-foreground">
          {serverName} · {secure ? "FTPS" : "FTP"}
        </span>
        <Button size="sm" variant="ghost" onClick={parent} title="Up">
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => connId && refresh(connId, cwd)}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onMkdir} title="New folder">
          <FolderPlus className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onUpload} title="Upload">
          <Upload className="h-4 w-4" />
        </Button>
        <span className="ml-2 truncate font-mono text-xs text-muted-foreground">
          {cwd}
        </span>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        )}
        {!loading &&
          entries.map((f) => (
            <div
              key={f.path}
              onClick={() => setSelected(f.path)}
              onDoubleClick={() => onOpen(f)}
              className={`group flex cursor-default items-center gap-2 px-3 py-1 ${
                selected === f.path ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              {f.is_dir ? (
                <Folder className="h-4 w-4 shrink-0 text-blue-400" />
              ) : (
                <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1 truncate">{f.name}</span>
              <span className="w-20 text-right text-xs text-muted-foreground">
                {f.is_dir ? "" : fmtSize(f.size)}
              </span>
              <span className="hidden items-center gap-1 group-hover:flex">
                {!f.is_dir && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(f);
                    }}
                    title="Download"
                    className="rounded p-1 hover:bg-background"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(f);
                  }}
                  title="Rename"
                  className="rounded p-1 hover:bg-background"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(f);
                  }}
                  title="Delete"
                  className="rounded p-1 text-destructive hover:bg-background"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
        {!loading && entries.length === 0 && !error && (
          <div className="p-3 text-xs text-muted-foreground">Empty directory</div>
        )}
      </div>
    </div>
  );
}
