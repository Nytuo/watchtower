import { create } from "zustand";
import type { ConnectionLog } from "@/lib/tauri";
import { useAdhocStore } from "@/stores/adhoc-store";

export interface Session {
  id: string;
  serverId: string;
  serverName: string;
  host: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  backendId?: string;
  error?: string;
  title?: string;
  latencyMs?: number;
  kind?: "ssh" | "telnet" | "mosh" | "ftp";
  paneOf?: string;
  splitDir?: "h" | "v";
  logs: ConnectionLog[];
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;

  addSession: (session: Omit<Session, "logs">) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;
  updateSession: (id: string, updates: Partial<Omit<Session, "id">>) => void;
  getSession: (id: string) => Session | undefined;
  addSessionLog: (id: string, log: ConnectionLog) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) => {
    set((state) => ({
      sessions: [...state.sessions, { ...session, logs: [] }],
      activeSessionId: session.id,
    }));
  },

  removeSession: (id: string) => {
    set((state) => {
      const closing = state.sessions.find((s) => s.id === id);
      if (closing?.serverId?.startsWith("adhoc:")) {
        useAdhocStore.getState().remove(closing.serverId);
      }
      const filtered = state.sessions.filter(
        (s) => s.id !== id && s.paneOf !== id,
      );
      const newActive =
        state.activeSessionId === id
          ? filtered.length > 0
            ? filtered[filtered.length - 1].id
            : null
          : state.activeSessionId;
      return { sessions: filtered, activeSessionId: newActive };
    });
  },

  setActiveSession: (id: string | null) => {
    set({ activeSessionId: id });
  },

  updateSession: (id: string, updates: Partial<Omit<Session, "id">>) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, ...updates } : s,
      ),
    }));
  },

  getSession: (id: string) => {
    return get().sessions.find((s) => s.id === id);
  },

  addSessionLog: (id: string, log: ConnectionLog) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, logs: [...s.logs, log] } : s,
      ),
    }));
  },
}));
