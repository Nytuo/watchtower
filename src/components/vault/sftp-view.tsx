import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  File,
  ChevronLeft,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  Plus,
  MoreVertical,
  Search,
  HardDrive,
  Loader2,
  Pencil,
  Check,
  X as CloseIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  sftpLs,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpDownload,
  sftpDownloadRecursive,
  sftpUpload,
  type RemoteFile,
  Channel,
  type TransferProgress,
} from "@/lib/tauri";
import { useUiStore } from "@/stores/ui-store";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface SftpViewProps {
  sessionId: string;
  backendId?: string;
  serverName: string;
  active: boolean;
}

export function SftpView({
  sessionId,
  backendId,
  serverName,
  active,
}: SftpViewProps) {
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const { addToast, updateToast } = useUiStore();

  const loadFiles = useCallback(
    async (path: string) => {
      if (!backendId) return;
      setLoading(true);
      try {
        const result = await sftpLs(backendId, path);
        const sorted = result.sort((a, b) => {
          if (a.is_dir && !b.is_dir) return -1;
          if (!a.is_dir && b.is_dir) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
        setCurrentPath(path);
      } catch (e) {
        addToast({
          title: "Error listing files",
          description: String(e),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [backendId, addToast],
  );

  useEffect(() => {
    const unlisten = getCurrentWindow().listen(
      "tauri://drag-drop",
      async (event: any) => {
        if (!active || !backendId) return;

        const paths = event.payload.paths as string[];
        for (const localPath of paths) {
          const fileName = localPath.split(/[/\\]/).pop() || "uploaded_file";
          const remotePath =
            currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;

          const toastId = addToast({
            title: "Upload started",
            description: `Uploading ${fileName}...`,
            progress: 0,
          });

          try {
            const onProgress = new Channel<TransferProgress>();
            onProgress.onmessage = (progress) => {
              const percent =
                progress.total_bytes > 0
                  ? Math.round(
                      (progress.bytes_sent / progress.total_bytes) * 100,
                    )
                  : 0;
              updateToast(toastId, { progress: percent });
            };

            await sftpUpload(backendId, localPath, remotePath, onProgress);

            updateToast(toastId, {
              title: "Upload complete",
              description: `Successfully uploaded ${fileName}.`,
              progress: 100,
            });
          } catch (e) {
            updateToast(toastId, {
              title: "Upload failed",
              description: String(e),
              variant: "destructive",
              progress: undefined,
            });
          }
        }
        loadFiles(currentPath);
      },
    );

    return () => {
      unlisten.then((f) => f());
    };
  }, [active, backendId, currentPath, addToast, updateToast, loadFiles]);

  useEffect(() => {
    if (active && backendId && files.length === 0 && !loading) {
      loadFiles("/");
    }
  }, [active, backendId, files.length, loading, loadFiles]);

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  const handleNavigate = (file: RemoteFile) => {
    if (file.is_dir) {
      loadFiles(file.path);
    }
  };

  const handleGoBack = () => {
    if (currentPath === "/") return;
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    const parentPath = "/" + parts.join("/");
    loadFiles(parentPath);
  };

  const handleDownload = async (file: RemoteFile) => {
    if (!backendId) return;

    try {
      if (file.is_dir) {
        const localDestDir = await open({
          directory: true,
          multiple: false,
          title: "Select Destination Folder",
        });

        if (!localDestDir) return;

        const toastId = addToast({
          title: "Folder download started",
          description: `Preparing to download ${file.name}...`,
          progress: 0,
        });

        const onProgress = new Channel<TransferProgress>();
        onProgress.onmessage = (progress) => {
          const percent =
            progress.total_bytes > 0
              ? Math.round((progress.bytes_sent / progress.total_bytes) * 100)
              : 0;
          updateToast(toastId, {
            description: `Downloading ${file.name}... (${percent}%)`,
            progress: percent,
          });
        };

        await sftpDownloadRecursive(
          backendId,
          file.path,
          localDestDir as string,
          onProgress,
        );

        updateToast(toastId, {
          title: "Folder download complete",
          description: `Successfully downloaded ${file.name}.`,
          progress: 100,
        });
      } else {
        const localPath = await save({
          defaultPath: file.name,
          title: "Save Remote File",
        });

        if (!localPath) return;

        const toastId = addToast({
          title: "Download started",
          description: `Downloading ${file.name}...`,
          progress: 0,
        });

        const onProgress = new Channel<TransferProgress>();
        onProgress.onmessage = (progress) => {
          const percent =
            progress.total_bytes > 0
              ? Math.round((progress.bytes_sent / progress.total_bytes) * 100)
              : 0;
          updateToast(toastId, { progress: percent });
        };

        await sftpDownload(backendId, file.path, localPath, onProgress);

        updateToast(toastId, {
          title: "Download complete",
          description: `Successfully downloaded ${file.name}.`,
          progress: 100,
        });
      }
    } catch (e) {
      addToast({
        title: "Download failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleUpload = async () => {
    if (!backendId) return;

    try {
      const selected = await open({
        multiple: false,
        title: "Select File to Upload",
      });

      if (!selected) return;

      const localPath = Array.isArray(selected) ? selected[0] : selected;
      const fileName = localPath.split(/[/\\]/).pop() || "uploaded_file";
      const remotePath =
        currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;

      const toastId = addToast({
        title: "Upload started",
        description: `Uploading ${fileName}...`,
        progress: 0,
      });

      const onProgress = new Channel<TransferProgress>();
      onProgress.onmessage = (progress) => {
        const percent =
          progress.total_bytes > 0
            ? Math.round((progress.bytes_sent / progress.total_bytes) * 100)
            : 0;
        updateToast(toastId, { progress: percent });
      };

      await sftpUpload(backendId, localPath, remotePath, onProgress);

      updateToast(toastId, {
        title: "Upload complete",
        description: `Successfully uploaded ${fileName}.`,
        progress: 100,
      });

      loadFiles(currentPath);
    } catch (e) {
      addToast({
        title: "Upload failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleMkdir = async () => {
    if (!backendId || !newFolderName.trim()) return;

    try {
      const name = newFolderName.trim();
      const parent = currentPath === "/" ? "" : currentPath;
      const path = `${parent}/${name}`;

      await sftpMkdir(backendId, path);
      addToast({
        title: "Folder created",
        description: `Successfully created ${name}.`,
      });
      setIsCreatingFolder(false);
      setNewFolderName("");
      loadFiles(currentPath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleRename = async (file: RemoteFile) => {
    if (!backendId) return;
    const newName = window.prompt("Enter new name:", file.name);
    if (!newName || newName === file.name) return;

    try {
      const parent = currentPath === "/" ? "" : currentPath;
      const newPath = `${parent}/${newName}`;
      await sftpRename(backendId, file.path, newPath);
      addToast({
        title: "Renamed",
        description: `Successfully renamed to ${newName}.`,
      });
      loadFiles(currentPath);
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (file: RemoteFile) => {
    if (!backendId) return;

    try {
      addToast({
        title: "Deleting...",
        description: `Removing ${file.name}...`,
      });

      await sftpRemove(backendId, file.path, file.is_dir);

      addToast({
        title: "Deleted",
        description: `Successfully removed ${file.name}.`,
      });

      loadFiles(currentPath);
    } catch (e) {
      addToast({
        title: "Delete failed",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (!active) return null;

  if (!backendId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-50" />
        <p className="text-sm">Connecting to SSH session...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleGoBack}
          disabled={currentPath === "/"}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 flex items-center bg-muted/50 rounded-md px-2 py-1 gap-2 text-sm font-mono overflow-hidden">
          <HardDrive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate" title={currentPath}>
            {currentPath}
          </span>
        </div>
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter..."
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => loadFiles(currentPath)}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button
          variant="ghost"
          size="icon"
          title="Upload"
          onClick={handleUpload}
        >
          <Upload className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="New Folder"
          onClick={() => {
            setIsCreatingFolder(true);
            setNewFolderName("New Folder");
          }}
          className={isCreatingFolder ? "bg-accent" : ""}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm text-left border-collapse">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm text-muted-foreground text-[10px] uppercase font-semibold z-10">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium w-24">Size</th>
              <th className="px-4 py-2 font-medium w-32 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isCreatingFolder && (
              <tr className="bg-accent/30 animate-in fade-in slide-in-from-top-1">
                <td className="px-4 py-1.5 flex items-center gap-2.5">
                  <Folder className="h-4 w-4 text-blue-400 fill-blue-400/20" />
                  <Input
                    autoFocus
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleMkdir();
                      if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                    className="h-7 text-sm py-0"
                  />
                </td>
                <td className="px-4 py-1.5 text-muted-foreground text-xs">
                  --
                </td>
                <td className="px-4 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-green-500"
                      onClick={handleMkdir}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }}
                    >
                      <CloseIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            )}

            {filteredFiles.map((file) => (
              <tr
                key={file.path}
                className="group hover:bg-accent/50 cursor-pointer transition-colors relative"
                onDoubleClick={() => handleNavigate(file)}
              >
                <td className="px-4 py-1.5 flex items-center gap-2.5 min-w-0">
                  {file.is_dir ? (
                    <Folder className="h-4 w-4 text-blue-400 fill-blue-400/20" />
                  ) : (
                    <File className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.name}</span>
                </td>
                <td className="px-4 py-1.5 text-muted-foreground text-xs whitespace-nowrap">
                  {file.is_dir ? "--" : formatSize(file.size)}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Download"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(file);
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(file);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="More"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContextMenu(
                            contextMenu === file.path ? null : file.path,
                          );
                        }}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>

                      {contextMenu === file.path && (
                        <div
                          className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-border bg-popover py-1 shadow-md text-left"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                            onClick={() => {
                              handleDownload(file);
                              setContextMenu(null);
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </button>
                          <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent"
                            onClick={() => {
                              handleRename(file);
                              setContextMenu(null);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <div className="h-px bg-border my-1" />
                          <button
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-accent"
                            onClick={() => {
                              handleRemove(file);
                              setContextMenu(null);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && filteredFiles.length === 0 && !isCreatingFolder && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-muted-foreground italic"
                >
                  No files found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
