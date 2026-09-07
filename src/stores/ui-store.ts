import { create } from "zustand";
import { applyTheme, readStoredTheme, storeTheme } from "@/lib/themes";

type Panel =
  | "groups"
  | "tags"
  | "snippets"
  | "keychains"
  | "port-forwarding"
  | "known-hosts"
  | "import"
  | "settings"
  | null;
export type ActiveView = "home" | "terminal" | "sftp" | "ftp";

interface UiStore {
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;

  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  showUnlockDialog: boolean;
  showServerForm: boolean;
  editingServerId: string | null;
  setShowUnlockDialog: (show: boolean) => void;
  setShowServerForm: (show: boolean) => void;
  setEditingServerId: (id: string | null) => void;

  activePanel: Panel;
  setActivePanel: (panel: Panel) => void;

  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;

  broadcastInput: boolean;
  setBroadcastInput: (on: boolean) => void;

  showShortcuts: boolean;
  setShowShortcuts: (show: boolean) => void;

  newGroupParent: string | null;
  setNewGroupParent: (id: string | null) => void;

  editingGroupId: string | null;
  editingTagId: string | null;
  editingSnippetId: string | null;
  editingKeychainId: string | null;
  editingPortForwardingId: string | null;
  setEditingGroupId: (id: string | null) => void;
  setEditingTagId: (id: string | null) => void;
  setEditingSnippetId: (id: string | null) => void;
  setEditingKeychainId: (id: string | null) => void;
  setEditingPortForwardingId: (id: string | null) => void;

  theme: string;
  setTheme: (theme: string) => void;

  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => void;
}

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "destructive";
  progress?: number;
}

let toastId = 0;

export const useUiStore = create<UiStore>((set) => ({
  sidebarOpen: true,
  sidebarWidth: 260,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarWidth: (width: number) => set({ sidebarWidth: width }),

  activeView: "home",
  setActiveView: (view) => set({ activeView: view }),

  showUnlockDialog: false,
  showServerForm: false,
  editingServerId: null,
  setShowUnlockDialog: (show: boolean) => set({ showUnlockDialog: show }),
  setShowServerForm: (show: boolean) =>
    set({ showServerForm: show, editingServerId: show ? null : null }),
  setEditingServerId: (id: string | null) =>
    set({ editingServerId: id, showServerForm: id !== null }),

  activePanel: null,
  setActivePanel: (panel) => set({ activePanel: panel }),

  showCommandPalette: false,
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),

  broadcastInput: false,
  setBroadcastInput: (on) => set({ broadcastInput: on }),

  showShortcuts: false,
  setShowShortcuts: (show) => set({ showShortcuts: show }),

  newGroupParent: null,
  setNewGroupParent: (id) => set({ newGroupParent: id }),

  editingGroupId: null,
  editingTagId: null,
  editingSnippetId: null,
  editingKeychainId: null,
  editingPortForwardingId: null,
  setEditingGroupId: (id) => set({ editingGroupId: id }),
  setEditingTagId: (id) => set({ editingTagId: id }),
  setEditingSnippetId: (id) => set({ editingSnippetId: id }),
  setEditingKeychainId: (id) => set({ editingKeychainId: id }),
  setEditingPortForwardingId: (id) => set({ editingPortForwardingId: id }),

  theme: readStoredTheme(),
  setTheme: (theme: string) => {
    applyTheme(theme);
    storeTheme(theme);
    set({ theme });
  },

  toasts: [],
  addToast: (toast) => {
    const id = String(++toastId);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));

    if (toast.progress === undefined && toast.variant !== "destructive") {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, 5000);
    }
    return id;
  },
  removeToast: (id: string) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  updateToast: (id: string, updates: Partial<Omit<Toast, "id">>) => {
    set((state) => ({
      toasts: state.toasts.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));

    if (updates.progress === 100) {
      setTimeout(() => {
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id),
        }));
      }, 5000);
    }
  },
}));
