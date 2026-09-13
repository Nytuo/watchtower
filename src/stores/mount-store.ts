import { create } from "zustand";
import {
  listMounts,
  mountCheckTool,
  mountSftp,
  unmountSftp,
  type MountInfo,
} from "@/lib/tauri";

interface MountStore {
  mounts: MountInfo[];
  busyIds: Set<string>;
  refresh: () => Promise<void>;
  mount: (serverId: string, remotePath?: string) => Promise<MountInfo>;
  unmount: (mountId: string) => Promise<void>;
  clearAll: () => void;
}

export const useMountStore = create<MountStore>((set) => ({
  mounts: [],
  busyIds: new Set(),

  refresh: async () => {
    try {
      set({ mounts: await listMounts() });
    } catch {
      /* backend not ready yet */
    }
  },

  mount: async (serverId, remotePath) => {
    set((s) => ({ busyIds: new Set(s.busyIds).add(serverId) }));
    try {
      try {
        const tool = await mountCheckTool();
        if (!tool.available) {
          throw new Error(`${tool.tool} not found. ${tool.hint}`);
        }
      } catch (e) {
        if (e instanceof Error) throw e;
      }
      const info = await mountSftp({ serverId, remotePath });
      set((s) => ({ mounts: [...s.mounts, info] }));
      return info;
    } finally {
      set((s) => {
        const next = new Set(s.busyIds);
        next.delete(serverId);
        return { busyIds: next };
      });
    }
  },

  unmount: async (mountId) => {
    await unmountSftp(mountId);
    set((s) => ({ mounts: s.mounts.filter((m) => m.id !== mountId) }));
  },

  clearAll: () => {
    set({ mounts: [], busyIds: new Set() });
  },
}));
