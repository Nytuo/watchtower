import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder,
  File,
  ChevronLeft,
  RefreshCw,
  Trash2,
  Plus,
  Search,
  Loader2,
  Pencil,
  ArrowRight,
  ArrowLeft,
  Monitor,
  Server as ServerIcon,
  X as CloseIcon,
  Eye,
  EyeOff,
  Star,
  ArrowUpDown,
  Lock,
  Copy,
  PencilLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sftpLs,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpChmod,
  sftpCopy,
  sftpDownload,
  sftpDownloadRecursive,
  sftpUpload,
  sftpUploadRecursive,
  sftpCancelTransfer,
  localHome,
  localLs,
  type RemoteFile,
  type LocalFile,
  Channel,
  type TransferProgress,
} from "@/lib/tauri";
import { useUiStore } from "@/stores/ui-store";
import { useTransferStore } from "@/stores/transfer-store";
import { promptDialog } from "@/stores/dialog-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { stat, mkdir as fsMkdir } from "@tauri-apps/plugin-fs";
import { tempDir, join } from "@tauri-apps/api/path";

interface SftpViewProps {
  sessionId: string;
  backendId?: string;
  serverName: string;
  active: boolean;
}

type Entry = {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  modified: number | null;
  permissions?: number | null;
};
type Side = "local" | "remote";
type SortKey = "name" | "size" | "modified";

const BOOKMARK_KEY = "watchtower:sftp:bookmarks";

function loadBookmarks(): Record<Side, string[]> {
  try {
    return {
      local: [],
      remote: [],
      ...JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "{}"),
    };
  } catch {
    return { local: [], remote: [] };
  }
}
function saveBookmarks(b: Record<Side, string[]>) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

function joinPath(base: string, name: string, sep: string) {
  return base.endsWith(sep) ? base + name : base + sep + name;
}
function parentPath(p: string, sep: string) {
  const esc = sep === "/" ? "/+$" : "\\\\+$";
  const trimmed = p.replace(new RegExp(esc), "");
  const idx = trimmed.lastIndexOf(sep);
  if (idx <= 0) return sep === "/" ? "/" : trimmed.slice(0, 3) || sep;
  return trimmed.slice(0, idx) || sep;
}
function formatSize(bytes: number) {
  if (!bytes) return "--";
  const k = 1024;
  const s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + s[i];
}
function fmtDate(sec: number | null) {
  if (!sec) return "";
  return new Date(sec * 1000).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
function newTransferId() {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const openEdits = new Map<
  string,
  { backendId: string; remote: string; local: string; mtime: number }
>();

export function SftpView({ backendId, active }: SftpViewProps) {
  const { addToast } = useUiStore();
  const {
    transfers,
    addTransfer,
    updateTransfer,
    removeTransfer,
    clearCompleted,
  } = useTransferStore();

  const [bookmarks, setBookmarks] = useState(loadBookmarks());
  const [showHidden, setShowHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "name",
    dir: 1,
  });

  const [localPath, setLocalPath] = useState("");
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [localSel, setLocalSel] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState("");

  const [remotePath, setRemotePath] = useState("/");
  const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);
  const [remoteSel, setRemoteSel] = useState<string | null>(null);
  const [remoteSearch, setRemoteSearch] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);

  const sep = "/";
  const localSep = localPath.includes("\\") ? "\\" : "/";
  const remotePathRef = useRef(remotePath);
  remotePathRef.current = remotePath;
  const localPathRef = useRef(localPath);
  localPathRef.current = localPath;

  const loadLocal = useCallback(
    async (path: string) => {
      try {
        setLocalFiles(await localLs(path));
        setLocalPath(path);
        setLocalSel(null);
      } catch (e) {
        addToast({
          title: "Local error",
          description: String(e),
          variant: "destructive",
        });
      }
    },
    [addToast],
  );

  const loadRemote = useCallback(
    async (path: string) => {
      if (!backendId) return;
      setRemoteLoading(true);
      try {
        setRemoteFiles(await sftpLs(backendId, path));
        setRemotePath(path);
        setRemoteSel(null);
      } catch (e) {
        addToast({
          title: "Remote error",
          description: String(e),
          variant: "destructive",
        });
      } finally {
        setRemoteLoading(false);
      }
    },
    [backendId, addToast],
  );

  useEffect(() => {
    if (active && !localPath) {
      localHome()
        .then((h) => loadLocal(h))
        .catch(() => loadLocal("/"));
    }
  }, [active, localPath, loadLocal]);

  useEffect(() => {
    if (active && backendId && remoteFiles.length === 0 && !remoteLoading) {
      loadRemote("/");
    }
  }, [active, backendId, remoteFiles.length, remoteLoading, loadRemote]);

  // OS drag-drop → upload to remote cwd
  useEffect(() => {
    const un = getCurrentWindow().listen(
      "tauri://drag-drop",
      async (ev: any) => {
        if (!active || !backendId) return;
        for (const p of ev.payload.paths as string[]) {
          const nm = p.split(/[/\\]/).pop() || "file";
          await runTransfer(
            "upload",
            p,
            joinPath(remotePathRef.current, nm, sep),
            nm,
            false,
          );
        }
        loadRemote(remotePathRef.current);
      },
    );
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, backendId]);

  // Watch open-for-edit files and re-upload on change
  useEffect(() => {
    if (!backendId) return;
    const iv = setInterval(async () => {
      for (const [key, ed] of openEdits) {
        if (ed.backendId !== backendId) continue;
        try {
          const s = await stat(ed.local);
          const m = s.mtime ? new Date(s.mtime).getTime() : 0;
          if (m > ed.mtime) {
            ed.mtime = m;
            openEdits.set(key, ed);
            await runTransfer(
              "upload",
              ed.local,
              ed.remote,
              ed.remote.split("/").pop() || "file",
              false,
            );
            addToast({ title: "Saved changes", description: ed.remote });
            if (remotePathRef.current === parentPath(ed.remote, "/"))
              loadRemote(remotePathRef.current);
          }
        } catch {
          /* file gone */
        }
      }
    }, 2500);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendId]);

  const runTransfer = async (
    dir: "upload" | "download",
    src: string,
    dst: string,
    fileName: string,
    recursive: boolean,
  ) => {
    if (!backendId) return;
    const id = newTransferId();
    addTransfer({
      id,
      fileName,
      sourcePath: src,
      destPath: dst,
      direction: dir,
      status: "active",
      progress: 0,
      bytesTransferred: 0,
      totalBytes: 0,
    });
    const ch = new Channel<TransferProgress>();
    ch.onmessage = (p) =>
      updateTransfer(id, {
        progress: p.total_bytes
          ? Math.round((p.bytes_sent / p.total_bytes) * 100)
          : 0,
        bytesTransferred: p.bytes_sent,
        totalBytes: p.total_bytes,
      });
    try {
      if (dir === "upload") {
        if (recursive) await sftpUploadRecursive(backendId, id, src, dst, ch);
        else await sftpUpload(backendId, id, src, dst, ch);
      } else {
        if (recursive) await sftpDownloadRecursive(backendId, id, src, dst, ch);
        else await sftpDownload(backendId, id, src, dst, ch);
      }
      updateTransfer(id, { status: "completed", progress: 100 });
    } catch (e) {
      updateTransfer(id, { status: "error", error: String(e) });
    }
  };

  const doUpload = async (f: Entry) => {
    await runTransfer(
      "upload",
      f.path,
      f.is_dir ? remotePath : joinPath(remotePath, f.name, sep),
      f.name,
      f.is_dir,
    );
    loadRemote(remotePath);
  };
  const doDownload = async (f: Entry) => {
    if (f.is_dir) {
      await runTransfer("download", f.path, localPath, f.name, true);
    } else {
      await runTransfer(
        "download",
        f.path,
        joinPath(localPath, f.name, localSep),
        f.name,
        false,
      );
    }
    loadLocal(localPath);
  };

  const editRemote = async (f: RemoteFile) => {
    if (!backendId || f.is_dir) return;
    try {
      const dir = await join(await tempDir(), "watchtower-edit");
      await fsMkdir(dir, { recursive: true }).catch(() => {});
      const local = await join(dir, `${Date.now()}-${f.name}`);
      await runTransfer("download", f.path, local, f.name, false);
      const s = await stat(local);
      openEdits.set(f.path, {
        backendId,
        remote: f.path,
        local,
        mtime: s.mtime ? new Date(s.mtime).getTime() : Date.now(),
      });
      await openPath(local);
      addToast({
        title: "Opened for editing",
        description: "Saved changes upload automatically.",
      });
    } catch (e) {
      addToast({
        title: "Edit failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const remoteMkdir = async () => {
    if (!backendId) return;
    const n = await promptDialog({ title: "New folder" });
    if (!n) return;
    try {
      await sftpMkdir(backendId, joinPath(remotePath, n, sep));
      loadRemote(remotePath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };
  const remoteRename = async (f: RemoteFile) => {
    if (!backendId) return;
    const n = await promptDialog({ title: "Rename", defaultValue: f.name });
    if (!n || n === f.name) return;
    try {
      await sftpRename(backendId, f.path, joinPath(remotePath, n, sep));
      loadRemote(remotePath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };
  const remoteDelete = async (f: RemoteFile) => {
    if (!backendId) return;
    try {
      await sftpRemove(backendId, f.path, f.is_dir);
      loadRemote(remotePath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };
  const remoteChmod = async (f: RemoteFile) => {
    if (!backendId) return;
    const cur = f.permissions ? (f.permissions & 0o777).toString(8) : "644";
    const n = await promptDialog({
      title: `Permissions for ${f.name}`,
      message: "Octal mode",
      defaultValue: cur,
    });
    if (!n) return;
    const mode = parseInt(n, 8);
    if (Number.isNaN(mode)) {
      addToast({ title: "Invalid octal mode", variant: "destructive" });
      return;
    }
    try {
      await sftpChmod(backendId, f.path, mode);
      loadRemote(remotePath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };
  const remoteCopy = async (f: RemoteFile) => {
    if (!backendId) return;
    const dst = await promptDialog({
      title: "Copy to",
      message: "Remote path",
      defaultValue: joinPath(remotePath, `${f.name}.copy`, sep),
    });
    if (!dst) return;
    try {
      await sftpCopy(backendId, f.path, dst);
      loadRemote(remotePath);
      addToast({ title: "Copied" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const pickAndUpload = async () => {
    const sel = await openDialog({ multiple: true, title: "Upload files" });
    if (!sel) return;
    const arr = Array.isArray(sel) ? sel : [sel];
    for (const p of arr) {
      const nm = p.split(/[/\\]/).pop() || "file";
      await runTransfer("upload", p, joinPath(remotePath, nm, sep), nm, false);
    }
    loadRemote(remotePath);
  };

  const toggleBookmark = (side: Side, path: string) => {
    setBookmarks((b) => {
      const list = b[side].includes(path)
        ? b[side].filter((x) => x !== path)
        : [...b[side], path];
      const next = { ...b, [side]: list };
      saveBookmarks(next);
      return next;
    });
  };

  const sortEntries = <T extends Entry>(list: T[]): T[] =>
    [...list].sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      let r = 0;
      if (sort.key === "name") r = a.name.localeCompare(b.name);
      else if (sort.key === "size") r = a.size - b.size;
      else r = (a.modified ?? 0) - (b.modified ?? 0);
      return r * sort.dir;
    });

  if (!active) return null;
  if (!backendId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">Connecting to SSH session…</p>
      </div>
    );
  }

  const filterHidden = (n: string) => showHidden || !n.startsWith(".");

  const localEntries: Entry[] = sortEntries(
    localFiles
      .filter((f) => filterHidden(f.name))
      .filter((f) => f.name.toLowerCase().includes(localSearch.toLowerCase()))
      .map((f) => ({ ...f, modified: f.modified })),
  );
  const remoteEntries: Entry[] = sortEntries(
    remoteFiles
      .filter((f) => filterHidden(f.name))
      .filter((f) => f.name.toLowerCase().includes(remoteSearch.toLowerCase()))
      .map((f) => ({ ...f, modified: f.modified ?? null })),
  );

  const activeTransfers = transfers.filter(
    (t) => t.status === "active" || t.status === "queued",
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 divide-x divide-border overflow-hidden">
        <Pane
          side="local"
          title="Local"
          icon={<Monitor className="h-3.5 w-3.5" />}
          path={localPath}
          setPath={loadLocal}
          onUp={() => loadLocal(parentPath(localPath, localSep))}
          canUp={localPath !== "/" && localPath !== ""}
          onRefresh={() => loadLocal(localPath)}
          loading={false}
          search={localSearch}
          setSearch={setLocalSearch}
          entries={localEntries}
          selected={localSel}
          onSelect={setLocalSel}
          onOpen={(e) => e.is_dir && loadLocal(e.path)}
          bookmarks={bookmarks.local}
          onToggleBookmark={(p) => toggleBookmark("local", p)}
          showHidden={showHidden}
          setShowHidden={setShowHidden}
          sort={sort}
          setSort={setSort}
          onDropFromOther={(names) => {
            const list = remoteFiles.filter((f) => names.includes(f.path));
            list.forEach((f) =>
              doDownload({ ...f, modified: f.modified ?? null }),
            );
          }}
          dragData={(e) => e.path}
          headerActions={
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              disabled={!localSel}
              onClick={() => {
                const f = localEntries.find((x) => x.path === localSel);
                if (f) doUpload(f);
              }}
            >
              Upload <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          }
          rowActions={null}
        />

        <Pane
          side="remote"
          title="Remote"
          icon={<ServerIcon className="h-3.5 w-3.5" />}
          path={remotePath}
          setPath={loadRemote}
          onUp={() => loadRemote(parentPath(remotePath, sep))}
          canUp={remotePath !== "/"}
          onRefresh={() => loadRemote(remotePath)}
          loading={remoteLoading}
          search={remoteSearch}
          setSearch={setRemoteSearch}
          entries={remoteEntries}
          selected={remoteSel}
          onSelect={setRemoteSel}
          onOpen={(e) => e.is_dir && loadRemote(e.path)}
          bookmarks={bookmarks.remote}
          onToggleBookmark={(p) => toggleBookmark("remote", p)}
          showHidden={showHidden}
          setShowHidden={setShowHidden}
          sort={sort}
          setSort={setSort}
          onDropFromOther={(names) => {
            const list = localFiles.filter((f) => names.includes(f.path));
            list.forEach((f) => doUpload({ ...f, modified: f.modified }));
          }}
          dragData={(e) => e.path}
          headerActions={
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                disabled={!remoteSel}
                onClick={() => {
                  const f = remoteEntries.find((x) => x.path === remoteSel);
                  if (f) doDownload(f);
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Download
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Upload from disk"
                onClick={pickAndUpload}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="New folder"
                onClick={remoteMkdir}
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          }
          rowActions={(e) => {
            const rf = remoteFiles.find((x) => x.path === e.path);
            if (!rf) return null;
            return (
              <div className="flex items-center gap-0.5">
                {!rf.is_dir && (
                  <IconBtn title="Edit" onClick={() => editRemote(rf)}>
                    <PencilLine className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
                <IconBtn title="Rename" onClick={() => remoteRename(rf)}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Permissions" onClick={() => remoteChmod(rf)}>
                  <Lock className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Copy" onClick={() => remoteCopy(rf)}>
                  <Copy className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn title="Delete" onClick={() => remoteDelete(rf)} danger>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            );
          }}
        />
      </div>

      {transfers.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-border bg-muted/30">
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground">
            <span>Transfers · {activeTransfers.length} active</span>
            <button className="hover:text-foreground" onClick={clearCompleted}>
              Clear finished
            </button>
          </div>
          {transfers.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-3 py-1 text-xs"
            >
              {t.direction === "upload" ? (
                <ArrowRight className="h-3 w-3 text-blue-400" />
              ) : (
                <ArrowLeft className="h-3 w-3 text-green-400" />
              )}
              <span className="w-40 truncate">{t.fileName}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${
                    t.status === "error" ? "bg-destructive" : "bg-primary"
                  }`}
                  style={{ width: `${t.progress}%` }}
                />
              </div>
              <span className="w-14 text-right text-muted-foreground">
                {t.status === "error" ? "error" : `${t.progress}%`}
              </span>
              {t.status === "active" ? (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  title="Cancel"
                  onClick={() => sftpCancelTransfer(t.id)}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              ) : (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeTransfer(t.id)}
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-7 w-7 ${danger ? "text-destructive hover:text-destructive" : ""}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </Button>
  );
}

function Pane({
  side,
  title,
  icon,
  path,
  setPath,
  onUp,
  canUp,
  onRefresh,
  loading,
  search,
  setSearch,
  entries,
  selected,
  onSelect,
  onOpen,
  bookmarks,
  onToggleBookmark,
  showHidden,
  setShowHidden,
  sort,
  setSort,
  onDropFromOther,
  dragData,
  headerActions,
  rowActions,
}: {
  side: Side;
  title: string;
  icon: React.ReactNode;
  path: string;
  setPath: (p: string) => void;
  onUp: () => void;
  canUp: boolean;
  onRefresh: () => void;
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  entries: Entry[];
  selected: string | null;
  onSelect: (p: string) => void;
  onOpen: (e: Entry) => void;
  bookmarks: string[];
  onToggleBookmark: (p: string) => void;
  showHidden: boolean;
  setShowHidden: (v: boolean) => void;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  onDropFromOther: (paths: string[]) => void;
  dragData: (e: Entry) => string;
  headerActions: React.ReactNode;
  rowActions: ((e: Entry) => React.ReactNode) | null;
}) {
  const [pathDraft, setPathDraft] = useState(path);
  const [editingPath, setEditingPath] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => setPathDraft(path), [path]);

  const cycleSort = (key: SortKey) =>
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 1 ? -1 : 1 }
        : { key, dir: 1 },
    );

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${dragOver ? "bg-accent/30" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-wt-path")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        const raw = e.dataTransfer.getData("application/x-wt-path");
        if (raw) onDropFromOther(JSON.parse(raw));
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-border p-1.5">
        <span className="flex items-center gap-1 px-1 text-xs font-medium text-muted-foreground">
          {icon}
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onUp}
          disabled={!canUp}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {editingPath ? (
          <input
            autoFocus
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onBlur={() => setEditingPath(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPath(pathDraft);
                setEditingPath(false);
              }
              if (e.key === "Escape") {
                setPathDraft(path);
                setEditingPath(false);
              }
            }}
            className="min-w-0 flex-1 rounded-md bg-muted/50 px-2 py-1 font-mono text-xs outline-none ring-1 ring-border"
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate rounded-md bg-muted/50 px-2 py-1 text-left font-mono text-xs"
            title={path}
            onClick={() => setEditingPath(true)}
          >
            {path || "…"}
          </button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border p-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={showHidden ? "Hide dotfiles" : "Show dotfiles"}
          onClick={() => setShowHidden(!showHidden)}
        >
          {showHidden ? (
            <Eye className="h-3.5 w-3.5" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={`Sort: ${sort.key} ${sort.dir === 1 ? "▲" : "▼"}`}
          onClick={() =>
            cycleSort(
              sort.key === "name"
                ? "size"
                : sort.key === "size"
                  ? "modified"
                  : "name",
            )
          }
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`h-7 w-7 ${bookmarks.includes(path) ? "text-yellow-500" : ""}`}
          title="Bookmark this folder"
          onClick={() => onToggleBookmark(path)}
        >
          <Star className="h-3.5 w-3.5" />
        </Button>
        {headerActions}
      </div>

      {bookmarks.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1">
          {bookmarks.map((b) => (
            <button
              key={b}
              onClick={() => setPath(b)}
              title={b}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {b.split(/[/\\]/).filter(Boolean).pop() || b}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.path}
                draggable
                onDragStart={(ev) => {
                  const payload = JSON.stringify([dragData(e)]);
                  ev.dataTransfer.setData("application/x-wt-path", payload);
                  ev.dataTransfer.setData("text/plain", e.name);
                }}
                className={`group cursor-pointer border-b border-border/40 transition-colors ${
                  selected === e.path ? "bg-accent" : "hover:bg-accent/40"
                }`}
                onClick={() => onSelect(e.path)}
                onDoubleClick={() => onOpen(e)}
              >
                <td className="flex items-center gap-2 px-3 py-1.5">
                  {e.is_dir ? (
                    <Folder className="h-4 w-4 shrink-0 text-blue-400" />
                  ) : (
                    <File className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{e.name}</span>
                </td>
                <td className="w-24 whitespace-nowrap px-2 py-1.5 text-right text-xs text-muted-foreground">
                  {e.is_dir ? "--" : formatSize(e.size)}
                </td>
                <td className="hidden w-32 whitespace-nowrap px-2 py-1.5 text-right text-[10px] text-muted-foreground lg:table-cell">
                  {fmtDate(e.modified)}
                </td>
                <td className="w-28 px-2 py-1.5 text-right">
                  <span className="opacity-0 group-hover:opacity-100">
                    {rowActions?.(e)}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-8 text-center text-xs italic text-muted-foreground"
                >
                  Empty
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border px-2 py-0.5 text-[10px] text-muted-foreground">
        drag rows onto the other pane to transfer · {side}
      </div>
    </div>
  );
}
