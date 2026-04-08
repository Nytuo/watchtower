import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder,
  FolderPlus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Channel,
  localDownloadsDir,
  sftpChmod,
  sftpDownload,
  sftpLs,
  sftpMkdir,
  sftpReadText,
  sftpRealpath,
  sftpRemove,
  sftpRename,
  sftpUpload,
  sftpWriteText,
  type RemoteFile,
  type TransferProgress,
} from "@/lib/tauri";
import { useUiStore } from "@/stores/ui-store";
import { confirmDialog, promptDialog } from "@/stores/dialog-store";

function join(dir: string, name: string) {
  return dir === "/" ? `/${name}` : `${dir.replace(/\/+$/, "")}/${name}`;
}

function parent(p: string) {
  const t = p.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? "/" : t.slice(0, i);
}

function human(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(1)} GiB`;
}

interface Props {
  backendId: string;
  serverName: string;
  onClose: () => void;
}

export function MobileFiles({ backendId, serverName, onClose }: Props) {
  const addToast = useUiStore((s) => s.addToast);
  const [path, setPath] = useState("/");
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<RemoteFile | null>(null);
  const [editing, setEditing] = useState<{
    file: RemoteFile;
    text: string;
    orig: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const first = useRef(true);

  const fail = useCallback(
    (title: string, e: unknown) =>
      addToast({ title, description: String(e), variant: "destructive" }),
    [addToast],
  );

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      try {
        const list = await sftpLs(backendId, p);
        list.sort(
          (a, b) =>
            Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name),
        );
        setFiles(list);
        setPath(p);
      } catch (e) {
        fail("Could not list folder", e);
      } finally {
        setLoading(false);
      }
    },
    [backendId, fail],
  );

  useEffect(() => {
    if (!first.current) return;
    first.current = false;
    (document.activeElement as HTMLElement | null)?.blur?.();
    sftpRealpath(backendId, ".")
      .then(load)
      .catch(() => load("/"));
  }, [load, backendId]);

  const transfer = async (
    dir: "up" | "down",
    local: string,
    remote: string,
    label: string,
  ) => {
    setBusy(label);
    const ch = new Channel<TransferProgress>();
    ch.onmessage = (p) =>
      setBusy(
        `${label} ${p.total_bytes ? Math.round((p.bytes_sent / p.total_bytes) * 100) : 0}%`,
      );
    const id = `m-${Date.now()}`;
    try {
      if (dir === "down") await sftpDownload(backendId, id, remote, local, ch);
      else await sftpUpload(backendId, id, local, remote, ch);
    } finally {
      setBusy(null);
    }
  };

  const download = async (f: RemoteFile) => {
    try {
      const dir = await localDownloadsDir();
      const dest = `${dir}/${f.name.replace(/[/\\]/g, "_")}`;
      await transfer("down", dest, f.path, `Downloading ${f.name}`);
      addToast({ title: "Downloaded", description: dest });
    } catch (e) {
      fail("Download failed", e);
    }
  };

  const upload = async () => {
    try {
      const sel = await openDialog({ multiple: false, title: "Upload file" });
      if (!sel || typeof sel !== "string") return;
      const name = sel.split(/[/\\]/).pop() ?? "upload";
      await transfer("up", sel, join(path, name), `Uploading ${name}`);
      load(path);
    } catch (e) {
      fail("Upload failed", e);
    }
  };

  const edit = async (f: RemoteFile) => {
    setBusy("Opening…");
    try {
      const text = await sftpReadText(backendId, f.path);
      setEditing({ file: f, text, orig: text });
    } catch (e) {
      fail("Cannot edit this file", e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!editing) return;
    try {
      await sftpWriteText(backendId, editing.file.path, editing.text);
      setEditing({ ...editing, orig: editing.text });
      addToast({ title: `Saved ${editing.file.name}` });
    } catch (e) {
      fail("Save failed", e);
    }
  };

  const closeEditor = async () => {
    if (
      editing &&
      editing.text !== editing.orig &&
      !(await confirmDialog({
        title: "Discard changes?",
        message: "Unsaved edits to this file will be lost.",
        confirmLabel: "Discard",
        danger: true,
      }))
    )
      return;
    setEditing(null);
  };

  const rename = async (f: RemoteFile) => {
    const n = await promptDialog({ title: "Rename", defaultValue: f.name });
    if (!n || n === f.name) return;
    try {
      await sftpRename(backendId, f.path, join(path, n));
      load(path);
    } catch (e) {
      fail("Rename failed", e);
    }
  };

  const remove = async (f: RemoteFile) => {
    if (
      !(await confirmDialog({
        title: `Delete ${f.name}?`,
        message: f.is_dir
          ? "The folder and its contents will be removed."
          : undefined,
        confirmLabel: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await sftpRemove(backendId, f.path, f.is_dir);
      load(path);
    } catch (e) {
      fail("Delete failed", e);
    }
  };

  const chmod = async (f: RemoteFile) => {
    const cur = f.permissions ? (f.permissions & 0o777).toString(8) : "644";
    const n = await promptDialog({
      title: `Permissions for ${f.name}`,
      message: "Octal mode",
      defaultValue: cur,
    });
    if (!n) return;
    const mode = parseInt(n, 8);
    if (Number.isNaN(mode)) return fail("Invalid mode", n);
    try {
      await sftpChmod(backendId, f.path, mode);
      load(path);
    } catch (e) {
      fail("chmod failed", e);
    }
  };

  const mkdir = async () => {
    const n = await promptDialog({ title: "New folder" });
    if (!n) return;
    try {
      await sftpMkdir(backendId, join(path, n));
      load(path);
    } catch (e) {
      fail("Could not create folder", e);
    }
  };

  if (editing) {
    const dirty = editing.text !== editing.orig;
    return (
      <div className="absolute inset-0 z-30 flex flex-col bg-background">
        <div className="flex items-center gap-2 border-b border-border px-2 py-2">
          <button
            className="p-2"
            onClick={closeEditor}
            aria-label="Close editor"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {editing.file.name}
              {dirty ? " •" : ""}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {editing.file.path}
            </div>
          </div>
          <button
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40"
            disabled={!dirty}
            onClick={save}
          >
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
        <textarea
          value={editing.text}
          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          className="min-h-0 flex-1 resize-none overflow-auto bg-background p-3 font-mono text-[13px] leading-5 outline-none"
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="flex items-center gap-1 border-b border-border px-2 py-2">
        <button className="p-2" onClick={onClose} aria-label="Back to terminal">
          <X className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{serverName}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {path}
          </div>
        </div>
        <button className="p-2" onClick={() => load(path)} aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button
          className="p-2"
          onClick={() => setShowHidden((v) => !v)}
          aria-label="Toggle hidden files"
        >
          {showHidden ? (
            <Eye className="h-5 w-5" />
          ) : (
            <EyeOff className="h-5 w-5" />
          )}
        </button>
        <button className="p-2" onClick={mkdir} aria-label="New folder">
          <FolderPlus className="h-5 w-5" />
        </button>
        <button className="p-2" onClick={upload} aria-label="Upload">
          <Upload className="h-5 w-5" />
        </button>
      </div>

      {busy && (
        <div className="border-b border-border bg-muted px-3 py-1.5 text-xs">
          {busy}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {path !== "/" && (
          <button
            className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left text-sm active:bg-accent"
            onClick={() => load(parent(path))}
          >
            <ArrowUp className="h-4 w-4 text-muted-foreground" /> ..
          </button>
        )}
        {files
          .filter((f) => showHidden || !f.name.startsWith("."))
          .map((f) => (
            <div
              key={f.path}
              className="flex items-center border-b border-border"
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left active:bg-accent"
                onClick={() => (f.is_dir ? load(f.path) : edit(f))}
              >
                {f.is_dir ? (
                  <Folder className="h-5 w-5 shrink-0 text-blue-400" />
                ) : (
                  <FileIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{f.name}</span>
                  {!f.is_dir && (
                    <span className="block text-[11px] text-muted-foreground">
                      {human(f.size)}
                    </span>
                  )}
                </span>
              </button>
              <button
                className="p-3 text-muted-foreground"
                onClick={() => setMenu(f)}
                aria-label={`Actions for ${f.name}`}
              >
                <MoreVertical className="h-4 w-4" />
              </button>
            </div>
          ))}
        {!loading && files.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Empty folder.
          </p>
        )}
      </div>

      {menu && (
        <div
          className="absolute inset-0 z-40 flex items-end bg-black/50"
          onClick={() => setMenu(null)}
        >
          <div
            className="w-full rounded-t-xl border-t border-border bg-popover pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="truncate px-4 py-3 text-sm font-medium">
              {menu.name}
            </div>
            {[
              !menu.is_dir && { l: "Edit", i: Pencil, f: () => edit(menu) },
              !menu.is_dir && {
                l: "Download",
                i: Download,
                f: () => download(menu),
              },
              { l: "Rename", i: Pencil, f: () => rename(menu) },
              { l: "Permissions", i: FileIcon, f: () => chmod(menu) },
              { l: "Delete", i: Trash2, f: () => remove(menu), d: true },
            ]
              .filter(Boolean)
              .map((a) => {
                const it = a as {
                  l: string;
                  i: typeof Pencil;
                  f: () => void;
                  d?: boolean;
                };
                return (
                  <button
                    key={it.l}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm active:bg-accent ${
                      it.d ? "text-destructive" : ""
                    }`}
                    onClick={() => {
                      setMenu(null);
                      it.f();
                    }}
                  >
                    <it.i className="h-4 w-4" /> {it.l}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
