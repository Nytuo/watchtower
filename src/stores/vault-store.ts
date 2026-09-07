import { create } from "zustand";
import {
  vaultCreate,
  vaultOpen,
  vaultLock,
  vaultExists,
  vaultListServers,
  vaultAddServer,
  vaultUpdateServer,
  vaultDeleteServer,
  vaultDuplicateServer,
  vaultBulkUpdateServers,
  vaultReorderServers,
  vaultListGroups,
  vaultAddGroup,
  vaultUpdateGroup,
  vaultDeleteGroup,
  vaultListTags,
  vaultAddTag,
  vaultUpdateTag,
  vaultDeleteTag,
  vaultListSnippets,
  vaultAddSnippet,
  vaultUpdateSnippet,
  vaultDeleteSnippet,
  vaultTouchSnippet,
  vaultListKeychains,
  vaultAddKeychain,
  vaultUpdateKeychain,
  vaultDeleteKeychain,
  vaultListPortForwardings,
  vaultAddPortForwarding,
  vaultUpdatePortForwarding,
  vaultDeletePortForwarding,
  vaultListKnownHosts,
  vaultAddKnownHost,
  vaultDeleteKnownHost,
  vaultTrustKnownHost,
  vaultGetSettings,
  vaultUpdateSettings,
  type ServerInfo,
  type AddServerParams,
  type UpdateServerParams,
  type ServerGroup,
  type Tag,
  type Snippet,
  type KeychainEntry,
  type CredentialType,
  type PortForwardingRule,
  type KnownHost,
  type VaultSettings,
} from "@/lib/tauri";
import { useUiStore } from "@/stores/ui-store";

interface VaultStore {
  isUnlocked: boolean;
  vaultExists: boolean;
  servers: ServerInfo[];
  groups: ServerGroup[];
  tags: Tag[];
  snippets: Snippet[];
  keychains: KeychainEntry[];
  portForwardings: PortForwardingRule[];
  knownHosts: KnownHost[];
  settings: VaultSettings | null;
  loading: boolean;
  error: string | null;

  checkVaultExists: () => Promise<void>;
  createVault: (password: string, path?: string) => Promise<void>;
  openVault: (password: string, path?: string) => Promise<void>;
  lockVault: () => Promise<void>;
  refreshAll: () => Promise<void>;

  refreshServers: () => Promise<void>;
  addServer: (params: AddServerParams) => Promise<ServerInfo>;
  updateServer: (params: UpdateServerParams) => Promise<ServerInfo>;
  deleteServer: (id: string) => Promise<void>;
  duplicateServer: (id: string) => Promise<ServerInfo>;
  bulkUpdateServers: (
    params: Parameters<typeof vaultBulkUpdateServers>[0],
  ) => Promise<void>;
  reorderServers: (orderedIds: string[]) => Promise<void>;

  refreshGroups: () => Promise<void>;
  addGroup: (
    name: string,
    opts?: { color?: string; icon?: string; parentId?: string; order?: number },
  ) => Promise<ServerGroup>;
  updateGroup: (
    id: string,
    updates: {
      name?: string;
      color?: string;
      icon?: string;
      parentId?: string;
      order?: number;
    },
  ) => Promise<ServerGroup>;
  deleteGroup: (id: string) => Promise<void>;

  refreshTags: () => Promise<void>;
  addTag: (name: string, color?: string) => Promise<Tag>;
  updateTag: (id: string, name?: string, color?: string) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;

  refreshSnippets: () => Promise<void>;
  addSnippet: (
    params: Parameters<typeof vaultAddSnippet>[0],
  ) => Promise<Snippet>;
  updateSnippet: (
    params: Parameters<typeof vaultUpdateSnippet>[0],
  ) => Promise<Snippet>;
  deleteSnippet: (id: string) => Promise<void>;
  touchSnippet: (id: string) => Promise<void>;

  refreshKeychains: () => Promise<void>;
  addKeychain: (
    name: string,
    credential: CredentialType,
  ) => Promise<KeychainEntry>;
  updateKeychain: (
    id: string,
    name?: string,
    credential?: CredentialType,
  ) => Promise<KeychainEntry>;
  deleteKeychain: (id: string) => Promise<void>;

  refreshPortForwardings: () => Promise<void>;
  addPortForwarding: (params: {
    name: string;
    ruleType: "local" | "remote" | "dynamic";
    localHost: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
    autoStart?: boolean;
    serverId?: string;
  }) => Promise<PortForwardingRule>;
  updatePortForwarding: (params: {
    id: string;
    name?: string;
    ruleType?: "local" | "remote" | "dynamic";
    localHost?: string;
    localPort?: number;
    remoteHost?: string;
    remotePort?: number;
    autoStart?: boolean;
    serverId?: string;
  }) => Promise<PortForwardingRule>;
  deletePortForwarding: (id: string) => Promise<void>;

  refreshKnownHosts: () => Promise<void>;
  addKnownHost: (params: {
    host: string;
    port: number;
    keyType: string;
    keyFingerprint: string;
    keyData?: string;
    trusted?: boolean;
  }) => Promise<KnownHost>;
  deleteKnownHost: (host: string, port: number) => Promise<void>;
  trustKnownHost: (
    host: string,
    port: number,
    trusted: boolean,
  ) => Promise<void>;

  refreshSettings: () => Promise<void>;
  updateSettings: (params: {
    theme?: string;
    fontSize?: number;
    fontFamily?: string;
    defaultShell?: string;
    defaultEncoding?: string;
    logConnections?: boolean;
    logRetentionDays?: number;
    confirmOnDisconnect?: boolean;
    confirmOnDelete?: boolean;
    hostKeyPolicy?: string;
    autoLockMinutes?: number;
    autoReconnect?: boolean;
    syncMode?: string;
    syncUrl?: string;
    syncUsername?: string;
    syncPassword?: string;
    syncAuto?: boolean;
  }) => Promise<VaultSettings>;

  clearError: () => void;
}

const INITIAL_STATE = {
  isUnlocked: false,
  vaultExists: false,
  servers: [] as ServerInfo[],
  groups: [] as ServerGroup[],
  tags: [] as Tag[],
  snippets: [] as Snippet[],
  keychains: [] as KeychainEntry[],
  portForwardings: [] as PortForwardingRule[],
  knownHosts: [] as KnownHost[],
  settings: null as VaultSettings | null,
  loading: false,
  error: null as string | null,
};

export const useVaultStore = create<VaultStore>((set, get) => ({
  ...INITIAL_STATE,

  checkVaultExists: async () => {
    try {
      const exists = await vaultExists();
      set({ vaultExists: exists });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  createVault: async (password: string, path?: string) => {
    set({ loading: true, error: null });
    try {
      await vaultCreate(password, path);
      set({ isUnlocked: true, vaultExists: true, loading: false });
      await get().refreshAll();
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  openVault: async (password: string, path?: string) => {
    set({ loading: true, error: null });
    try {
      await vaultOpen(password, path);
      set({ isUnlocked: true, loading: false });
      await get().refreshAll();
    } catch (e) {
      set({ loading: false, error: String(e) });
      throw e;
    }
  },

  lockVault: async () => {
    try {
      await vaultLock();
      set({
        isUnlocked: false,
        servers: [],
        groups: [],
        tags: [],
        snippets: [],
        keychains: [],
        portForwardings: [],
        knownHosts: [],
        settings: null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refreshAll: async () => {
    const g = get();
    await Promise.all([
      g.refreshServers(),
      g.refreshGroups(),
      g.refreshTags(),
      g.refreshSnippets(),
      g.refreshKeychains(),
      g.refreshPortForwardings(),
      g.refreshKnownHosts(),
      g.refreshSettings(),
    ]);
  },

  refreshServers: async () => {
    try {
      const servers = await vaultListServers();
      set({ servers });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addServer: async (params) => {
    set({ error: null });
    try {
      const server = await vaultAddServer(params);
      await get().refreshServers();
      return server;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateServer: async (params) => {
    set({ error: null });
    try {
      const server = await vaultUpdateServer(params);
      await get().refreshServers();
      return server;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteServer: async (id) => {
    set({ error: null });
    try {
      await vaultDeleteServer(id);
      await get().refreshServers();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  duplicateServer: async (id) => {
    const s = await vaultDuplicateServer(id);
    await get().refreshServers();
    return s;
  },

  bulkUpdateServers: async (params) => {
    await vaultBulkUpdateServers(params);
    await get().refreshServers();
  },

  reorderServers: async (orderedIds: string[]) => {
    set((s) => ({
      servers: s.servers.map((sv) => {
        const i = orderedIds.indexOf(sv.id);
        return i === -1 ? sv : { ...sv, order: i };
      }),
    }));
    try {
      await vaultReorderServers(orderedIds);
    } catch (e) {
      set({ error: String(e) });
      await get().refreshServers();
    }
  },

  refreshGroups: async () => {
    try {
      const groups = await vaultListGroups();
      set({ groups });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addGroup: async (name, opts) => {
    set({ error: null });
    try {
      const group = await vaultAddGroup({ name, ...opts });
      await get().refreshGroups();
      return group;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateGroup: async (id, updates) => {
    set({ error: null });
    try {
      const group = await vaultUpdateGroup({ id, ...updates });
      await get().refreshGroups();
      return group;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteGroup: async (id) => {
    set({ error: null });
    try {
      await vaultDeleteGroup(id);
      await Promise.all([get().refreshGroups(), get().refreshServers()]);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshTags: async () => {
    try {
      const tags = await vaultListTags();
      set({ tags });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addTag: async (name, color) => {
    set({ error: null });
    try {
      const tag = await vaultAddTag(name, color);
      await get().refreshTags();
      return tag;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateTag: async (id, name, color) => {
    set({ error: null });
    try {
      const tag = await vaultUpdateTag(id, name, color);
      await get().refreshTags();
      return tag;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteTag: async (id) => {
    set({ error: null });
    try {
      await vaultDeleteTag(id);
      await Promise.all([
        get().refreshTags(),
        get().refreshServers(),
        get().refreshSnippets(),
      ]);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshSnippets: async () => {
    try {
      const snippets = await vaultListSnippets();
      set({ snippets });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addSnippet: async (params) => {
    set({ error: null });
    try {
      const snippet = await vaultAddSnippet(params);
      await get().refreshSnippets();
      return snippet;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateSnippet: async (params) => {
    set({ error: null });
    try {
      const snippet = await vaultUpdateSnippet(params);
      await get().refreshSnippets();
      return snippet;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteSnippet: async (id) => {
    set({ error: null });
    try {
      await vaultDeleteSnippet(id);
      await get().refreshSnippets();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  touchSnippet: async (id) => {
    try {
      await vaultTouchSnippet(id);
      await get().refreshSnippets();
    } catch {
      /* non-critical */
    }
  },

  refreshKeychains: async () => {
    try {
      const keychains = await vaultListKeychains();
      set({ keychains });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addKeychain: async (name, credential) => {
    set({ error: null });
    try {
      const entry = await vaultAddKeychain(name, credential);
      await get().refreshKeychains();
      return entry;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updateKeychain: async (id, name, credential) => {
    set({ error: null });
    try {
      const entry = await vaultUpdateKeychain(id, name, credential);
      await get().refreshKeychains();
      return entry;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteKeychain: async (id) => {
    set({ error: null });
    try {
      await vaultDeleteKeychain(id);
      await Promise.all([get().refreshKeychains(), get().refreshServers()]);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshPortForwardings: async () => {
    try {
      const portForwardings = await vaultListPortForwardings();
      set({ portForwardings });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addPortForwarding: async (params) => {
    set({ error: null });
    try {
      const rule = await vaultAddPortForwarding(params);
      await Promise.all([
        get().refreshPortForwardings(),
        get().refreshServers(),
      ]);
      return rule;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  updatePortForwarding: async (params) => {
    set({ error: null });
    try {
      const rule = await vaultUpdatePortForwarding(params);
      await get().refreshPortForwardings();
      return rule;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deletePortForwarding: async (id) => {
    set({ error: null });
    try {
      await vaultDeletePortForwarding(id);
      await Promise.all([
        get().refreshPortForwardings(),
        get().refreshServers(),
      ]);
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshKnownHosts: async () => {
    try {
      const knownHosts = await vaultListKnownHosts();
      set({ knownHosts });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addKnownHost: async (params) => {
    set({ error: null });
    try {
      const entry = await vaultAddKnownHost(params);
      await get().refreshKnownHosts();
      return entry;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  deleteKnownHost: async (host, port) => {
    set({ error: null });
    try {
      await vaultDeleteKnownHost(host, port);
      await get().refreshKnownHosts();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  trustKnownHost: async (host, port, trusted) => {
    set({ error: null });
    try {
      await vaultTrustKnownHost(host, port, trusted);
      await get().refreshKnownHosts();
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  refreshSettings: async () => {
    try {
      const settings = await vaultGetSettings();
      set({ settings });
      if (settings.theme) {
        const { theme, setTheme } = useUiStore.getState();
        if (settings.theme !== theme) setTheme(settings.theme);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateSettings: async (params) => {
    set({ error: null });
    try {
      const settings = await vaultUpdateSettings(params);
      set({ settings });
      return settings;
    } catch (e) {
      set({ error: String(e) });
      throw e;
    }
  },

  clearError: () => set({ error: null }),
}));
