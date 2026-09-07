import { useSessionStore } from "@/stores/session-store";
import { useUiStore } from "@/stores/ui-store";
import {
  useAdhocStore,
  makeAdhocServer,
  type AdhocConn,
} from "@/stores/adhoc-store";
import type { ServerInfo } from "@/lib/tauri";

let counter = 0;

export function connectServer(server: ServerInfo) {
  const id = `session-${server.id}-${Date.now()}-${++counter}`;
  useSessionStore.getState().addSession({
    id,
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    status: "connecting",
  });
  useSessionStore.getState().setActiveSession(id);
  const p = (server.protocol || "ssh").toLowerCase();
  useUiStore
    .getState()
    .setActiveView(
      p === "sftp" ? "sftp" : p === "ftp" || p === "ftps" ? "ftp" : "terminal",
    );
}

export function connectAdhoc(input: {
  host: string;
  port: number;
  username: string;
  authType: string;
  password?: string;
  keyPath?: string;
  passphrase?: string;
}) {
  const server = makeAdhocServer(input);
  const conn: AdhocConn = {
    server,
    authType: input.authType,
    password: input.password,
    keyPath: input.keyPath,
    passphrase: input.passphrase,
  };
  useAdhocStore.getState().add(conn);
  connectServer(server);
}
