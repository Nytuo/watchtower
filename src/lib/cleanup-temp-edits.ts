import { readDir, remove, stat } from "@tauri-apps/plugin-fs";
import { tempDir, join } from "@tauri-apps/api/path";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function cleanupStaleEditFiles(): Promise<void> {
  try {
    const dir = await join(await tempDir(), "watchtower-edit");
    const entries = await readDir(dir).catch(() => []);
    const now = Date.now();
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const path = await join(dir, entry.name ?? "");
      try {
        const info = await stat(path);
        const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
        if (now - mtime > MAX_AGE_MS) {
          await remove(path).catch(() => {});
        }
      } catch {
        /* ignore individual failures */
      }
    }
  } catch {
    /* best-effort cleanup only */
  }
}
