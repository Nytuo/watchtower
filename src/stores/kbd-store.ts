import { create } from "zustand";
import type { KbdPrompt } from "@/lib/tauri";

interface Pending {
  clientId: string;
  serverName: string;
  prompt: KbdPrompt;
}

interface KbdStore {
  pending: Pending | null;
  setPending: (p: Pending | null) => void;
}

export const useKbdStore = create<KbdStore>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));
