import { create } from "zustand";
import type { ServerInfo, AdvancedOptions } from "@/lib/tauri";

export interface AdhocConn {
  server: ServerInfo;
  authType: string;
  password?: string;
  keyPath?: string;
  passphrase?: string;
}

interface AdhocStore {
  conns: Record<string, AdhocConn>;
  add: (c: AdhocConn) => void;
  get: (id: string) => AdhocConn | undefined;
  remove: (id: string) => void;
}

export const useAdhocStore = create<AdhocStore>((set, get) => ({
  conns: {},
  add: (c) => set((s) => ({ conns: { ...s.conns, [c.server.id]: c } })),
  get: (id) => get().conns[id],
  remove: (id) =>
    set((s) => {
      const next = { ...s.conns };
      delete next[id];
      return { conns: next };
    }),
}));

const EMPTY_ADVANCED: AdvancedOptions = {
  agent_forwarding: false,
  startup_command: null,
  jump_hosts: [],
  proxy: null,
  env_vars: [],
  encoding: "UTF-8",
  use_mosh: false,
  mosh_port_range: null,
  keepalive_interval: null,
  keepalive_count_max: null,
  x11_forwarding: false,
  compression: false,
  transport: { type: "direct" },
};

let n = 0;

export function makeAdhocServer(input: {
  host: string;
  port: number;
  username: string;
}): ServerInfo {
  return {
    id: `adhoc:${Date.now()}-${++n}`,
    name: `${input.username}@${input.host}`,
    host: input.host,
    port: input.port,
    username: input.username,
    auth_type: "none",
    protocol: "ssh",
    group_id: null,
    color: null,
    icon: null,
    notes: null,
    tags: [],
    advanced: EMPTY_ADVANCED,
    port_forwarding_ids: [],
    keychain_id: null,
    pinned: false,
    order: 0,
    last_connected: null,
  };
}

// Parses "[user@]host[:port]"
export function parseTarget(raw: string): {
  host: string;
  port: number;
  username: string;
} | null {
  const s = raw.trim();
  if (!s) return null;
  let username = "";
  let rest = s;
  const at = s.lastIndexOf("@");
  if (at >= 0) {
    username = s.slice(0, at);
    rest = s.slice(at + 1);
  }
  let host = rest;
  let port = 22;
  // ipv6 [::1]:22
  const m6 = rest.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (m6) {
    host = m6[1];
    if (m6[2]) port = parseInt(m6[2]);
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon >= 0 && /^\d+$/.test(rest.slice(colon + 1))) {
      host = rest.slice(0, colon);
      port = parseInt(rest.slice(colon + 1));
    }
  }
  if (!host) return null;
  return { host, port, username: username || "root" };
}
