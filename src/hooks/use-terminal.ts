import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import {
  sshWrite,
  sshResize,
  sshConnect,
  sshSendStartupCommand,
  sshDetectOS,
  Channel,
} from "@/lib/tauri";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { osReleaseIdToSlug } from "@/components/icons/os-icons";
import type { ServerInfo, ConnectionLog } from "@/lib/tauri";

import "@xterm/xterm/css/xterm.css";

interface UseTerminalOptions {
  sessionId: string;
  server: ServerInfo;
}

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
} as const;

function writeLine(
  term: Terminal,
  disposed: { current: boolean },
  line: string,
) {
  if (disposed.current) return;
  try {
    term.writeln(line);
  } catch {
    /* terminal torn down mid-write */
  }
}

function writeSpacer(term: Terminal, disposed: { current: boolean }) {
  writeLine(term, disposed, "");
}

function writeLog(
  term: Terminal,
  disposed: { current: boolean },
  log: ConnectionLog,
) {
  if (disposed.current) return;
  const levelColor: Record<string, string> = {
    info: C.cyan,
    success: C.green,
    warning: C.yellow,
    error: C.red,
  };
  const glyph: Record<string, string> = {
    info: "\u2022",
    success: "\u2713",
    warning: "\u26a0",
    error: "\u2717",
  };
  const color = levelColor[log.level] ?? C.white;
  const icon = glyph[log.level] ?? "\u2022";
  const detail = log.detail ? ` ${C.dim}(${log.detail})${C.reset}` : "";
  writeLine(
    term,
    disposed,
    `  ${color}${icon}${C.reset} ${log.message}${detail}`,
  );
}

export function useTerminal({ sessionId, server }: UseTerminalOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const { updateSession } = useSessionStore();
  const { updateServer } = useVaultStore();
  const { addToast } = useUiStore();

  const safeFit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const container = containerRef.current;
    if (!fitAddon || !container) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      fitAddon.fit();
    } catch {
      /* terminal disposed between check and call */
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "JetBrains Mono, Menlo, Monaco, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#fafafa",
        cursor: "#fafafa",
        selectionBackground: "#264f78",
        black: "#000000",
        brightBlack: "#666666",
        red: "#cd3131",
        brightRed: "#f14c4c",
        green: "#0dbc79",
        brightGreen: "#23d18b",
        yellow: "#e5e510",
        brightYellow: "#f5f543",
        blue: "#2472c8",
        brightBlue: "#3b8eea",
        magenta: "#bc3fbc",
        brightMagenta: "#d670d6",
        cyan: "#11a8cd",
        brightCyan: "#29b8db",
        white: "#e5e5e5",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    const container = containerRef.current;
    container.innerHTML = "";
    term.open(container);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const disposedRef = {
      get current() {
        return disposed;
      },
    };

    async function run() {
      if (disposed) return;

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          safeFit();
          resolve();
        }),
      );
      if (disposed) return;

      writeSpacer(term, disposedRef);
      writeLine(
        term,
        disposedRef,
        `  ${C.bold}${C.blue}Watchtower${C.reset}  ${C.dim}SSH session${C.reset}`,
      );
      writeLine(
        term,
        disposedRef,
        `  ${C.dim}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${C.reset}`,
      );
      writeSpacer(term, disposedRef);
      writeLine(
        term,
        disposedRef,
        `  ${C.dim}Host${C.reset}   ${C.cyan}${server.host}${C.reset}${C.dim}:${server.port}${C.reset}`,
      );
      writeLine(
        term,
        disposedRef,
        `  ${C.dim}User${C.reset}   ${C.white}${server.username}${C.reset}`,
      );
      writeLine(
        term,
        disposedRef,
        `  ${C.dim}Auth${C.reset}   ${C.white}${server.auth_type}${C.reset}`,
      );
      writeSpacer(term, disposedRef);

      const cols = term.cols;
      const rows = term.rows;

      const dataChannel = new Channel<number[]>();
      dataChannel.onmessage = (data: number[]) => {
        if (disposed) return;
        try {
          term.write(new Uint8Array(data));
        } catch {
          /* disposed */
        }
      };

      const logChannel = new Channel<ConnectionLog>();
      logChannel.onmessage = (log: ConnectionLog) =>
        writeLog(term, disposedRef, log);

      writeLine(
        term,
        disposedRef,
        `  ${C.yellow}\u29d7${C.reset} Connecting to ${C.cyan}${server.host}:${server.port}${C.reset}…`,
      );

      try {
        const returnedId = await sshConnect(
          server.id,
          cols,
          rows,
          dataChannel,
          logChannel,
        );

        if (disposed) return;

        writeSpacer(term, disposedRef);
        writeLine(
          term,
          disposedRef,
          `  ${C.green}\u2713${C.reset} ${C.bold}Connected${C.reset}  ${C.dim}session ${returnedId.slice(0, 8)}…${C.reset}`,
        );
        writeSpacer(term, disposedRef);

        updateSession(sessionId, {
          status: "connected",
          backendId: returnedId,
        });

        if (!server.icon) {
          sshDetectOS(returnedId)
            .then((osId) => {
              const slug = osReleaseIdToSlug(osId);
              if (slug)
                updateServer({ id: server.id, icon: slug }).catch(() => {});
            })
            .catch(() => {});
        }

        if (server.advanced?.startup_command) {
          sshSendStartupCommand(returnedId, server.id).catch(() => {});
        }

        term.onData((data: string) => {
          if (disposed) return;
          sshWrite(
            returnedId,
            Array.from(new TextEncoder().encode(data)),
          ).catch(() => {});
        });

        term.onResize(({ cols, rows }) => {
          if (disposed) return;
          sshResize(returnedId, cols, rows).catch(() => {});
        });

        term.focus();
      } catch (e) {
        if (disposed) return;

        const errMsg = String(e);

        writeSpacer(term, disposedRef);
        writeLine(
          term,
          disposedRef,
          `  ${C.red}\u2717 Connection failed${C.reset}`,
        );
        writeLine(term, disposedRef, `  ${C.dim}${errMsg}${C.reset}`);
        writeSpacer(term, disposedRef);
        writeLine(
          term,
          disposedRef,
          `  ${C.dim}Press ${C.reset}${C.yellow}Ctrl+Shift+R${C.reset}${C.dim} or close and reconnect from the sidebar.${C.reset}`,
        );
        writeSpacer(term, disposedRef);

        updateSession(sessionId, { status: "error", error: errMsg });
        addToast({
          title: "Connection failed",
          description: errMsg,
          variant: "destructive",
        });
      }
    }

    run();

    return () => {
      disposed = true;
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    sessionId,
    server.id,
    server.host,
    server.port,
    server.username,
    server.auth_type,
  ]);

  useEffect(() => {
    window.addEventListener("resize", safeFit);
    const ro = new ResizeObserver(safeFit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", safeFit);
      ro.disconnect();
    };
  }, [safeFit]);

  return { containerRef, termRef, safeFit };
}
