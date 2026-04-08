import { create } from "zustand";

export interface TransferItem {
  id: string;
  fileName: string;
  sourcePath: string;
  destPath: string;
  direction: "upload" | "download";
  status: "queued" | "active" | "completed" | "error" | "paused";
  progress: number;
  bytesTransferred: number;
  totalBytes: number;
  error?: string;
}

interface TransferStore {
  transfers: TransferItem[];
  addTransfer: (transfer: TransferItem) => void;
  removeTransfer: (id: string) => void;
  updateTransfer: (id: string, updates: Partial<TransferItem>) => void;
  clearCompleted: () => void;
}

export const useTransferStore = create<TransferStore>((set) => ({
  transfers: [],

  addTransfer: (transfer: TransferItem) => {
    set((state) => ({ transfers: [...state.transfers, transfer] }));
  },

  removeTransfer: (id: string) => {
    set((state) => ({
      transfers: state.transfers.filter((t) => t.id !== id),
    }));
  },

  updateTransfer: (id: string, updates: Partial<TransferItem>) => {
    set((state) => ({
      transfers: state.transfers.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
  },

  clearCompleted: () => {
    set((state) => ({
      transfers: state.transfers.filter((t) => t.status !== "completed"),
    }));
  },
}));
