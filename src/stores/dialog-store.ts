import { create } from "zustand";

interface ConfirmReq {
  kind: "confirm";
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface PromptReq {
  kind: "prompt";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

type Req = ConfirmReq | PromptReq;

interface DialogStore {
  current: Req | null;
  _push: (r: Req) => void;
  _done: () => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  current: null,
  _push: (r) => set({ current: r }),
  _done: () => set({ current: null }),
}));

export function confirmDialog(opts: Omit<ConfirmReq, "kind" | "resolve">) {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState()._push({ kind: "confirm", ...opts, resolve });
  });
}

export function promptDialog(opts: Omit<PromptReq, "kind" | "resolve">) {
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState()._push({ kind: "prompt", ...opts, resolve });
  });
}
