import { create } from "zustand";

export type MobileTab = "hosts" | "sessions" | "snippets" | "more";

interface MobileStore {
  tab: MobileTab;
  setTab: (t: MobileTab) => void;
  /** Sticky modifiers applied to the next typed character. */
  ctrl: boolean;
  alt: boolean;
  setCtrl: (on: boolean) => void;
  setAlt: (on: boolean) => void;
  clearMods: () => void;
}

export const useMobileStore = create<MobileStore>((set) => ({
  tab: "hosts",
  setTab: (tab) => set({ tab }),
  ctrl: false,
  alt: false,
  setCtrl: (ctrl) => set({ ctrl }),
  setAlt: (alt) => set({ alt }),
  clearMods: () => set({ ctrl: false, alt: false }),
}));

/** Applies sticky Ctrl/Alt to a chunk of typed input. */
export function applyMods(data: string): string {
  const { ctrl, alt, clearMods } = useMobileStore.getState();
  if (!ctrl && !alt) return data;
  let out = data;
  if (ctrl && data.length === 1) {
    const c = data.toUpperCase().charCodeAt(0);
    if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64);
    else if (data === " ") out = "\x00";
    else if (data === "?") out = "\x7f";
  }
  if (alt) out = "\x1b" + out;
  clearMods();
  return out;
}
