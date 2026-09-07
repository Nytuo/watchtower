import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  sshConnect,
  sshConnectAdhoc,
  sshSendStartupCommand,
  sshDetectOS,
  tunnelStart,
  vaultMarkConnected,
  telnetConnect,
  moshConnect,
  termKindWrite,
  termKindResize,
  Channel,
} from "@/lib/tauri";
import { useSessionStore } from "@/stores/session-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { useAdhocStore } from "@/stores/adhoc-store";
import { osReleaseIdToSlug } from "@/components/icons/os-icons";
import { terminalPalette } from "@/lib/themes";
import { connectServer } from "@/lib/connect";
import { confirmDialog } from "@/stores/dialog-store";
import { useKbdStore } from "@/stores/kbd-store";
import {
  vaultAddKnownHost,
  vaultDeleteKnownHost,
  sshSubmitKbd,
} from "@/lib/tauri";
import type { ServerInfo, ConnectionLog, KbdPrompt } from "@/lib/tauri";

async function handleHostKeyPrompt(
  m: RegExpMatchArray,
  server: ServerInfo,
  reconnect: () => void,
) {
  const kind = m[1];
  const keyType = m[2];
  const fp = m[3];
  const expected = m[4];

  const ok = await confirmDialog({
    title: kind === "MISMATCH" ? "⚠ Host key CHANGED" : "Trust this host key?",
    message:
      kind === "MISMATCH"
        ? `The server now presents a different ${keyType} key.\n\nExpected  SHA256:${expected}\nOffered   SHA256:${fp}\n\nThis is what a man-in-the-middle attack looks like. Only continue if you personally know the key was rotated.`
        : `${server.host}:${server.port}\n${keyType}  SHA256:${fp}\n\nAdd it to your known hosts and connect?`,
    confirmLabel:
      kind === "MISMATCH" ? "Replace key & connect" : "Trust & connect",
    danger: kind === "MISMATCH",
  });
  if (!ok) return;

  try {
    if (kind === "MISMATCH") {
      await vaultDeleteKnownHost(server.host, server.port);
    }
    await vaultAddKnownHost({
      host: server.host,
      port: server.port,
      keyType,
      keyFingerprint: fp,
      trusted: true,
    });
    reconnect();
  } catch {
    /* surfaced elsewhere */
  }
}

import "@xterm/xterm/css/xterm.css";

interface UseTerminalOptions {
  sessionId: string;
  server: ServerInfo;
}

const FONT_SCALE_KEY = "watchtower:term:fontScale";
const SCROLLBACK_PREFIX = "watchtower:term:scrollback:";

function getFontScale(): number {
  try {
    const v = parseFloat(localStorage.getItem(FONT_SCALE_KEY) || "1");
    return Number.isFinite(v) && v > 0 ? v : 1;
  } catch {
    return 1;
  }
}
function setFontScale(v: number) {
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(v));
  } catch {
    /* ignore */
  }
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
    info: "•",
    success: "✓",
    warning: "⚠",
    error: "✗",
  };
  const color = levelColor[log.level] ?? C.white;
  const icon = glyph[log.level] ?? "•";
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
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);

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

  const zoom = useCallback(
    (dir: "in" | "out" | "reset") => {
      const term = termRef.current;
      if (!term) return;
      const settings = useVaultStore.getState().settings;
      const base = settings?.font_size ?? 14;
      let scale = getFontScale();
      if (dir === "in") scale = Math.min(scale + 0.1, 2.5);
      else if (dir === "out") scale = Math.max(scale - 0.1, 0.5);
      else scale = 1;
      setFontScale(scale);
      term.options.fontSize = Math.round(base * scale);
      requestAnimationFrame(safeFit);
    },
    [safeFit],
  );

  const clearBuffer = useCallback(() => {
    termRef.current?.clear();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let startupSent = false;
    const clientId = crypto.randomUUID();
    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const settings = useVaultStore.getState().settings;
    const baseFont = settings?.font_size ?? 14;
    const fontFamily =
      settings?.font_family || "JetBrains Mono, Menlo, Monaco, monospace";

    const encoding = (settings?.default_encoding || "utf-8").toLowerCase();
    let decoder: TextDecoder | null = null;
    if (encoding !== "utf-8" && encoding !== "utf8") {
      try {
        decoder = new TextDecoder(encoding, { fatal: false });
      } catch {
        decoder = null;
      }
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: Math.round(baseFont * getFontScale()),
      fontFamily,
      scrollback: 10000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: terminalPalette(useUiStore.getState().theme),
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(searchAddon);
    term.loadAddon(serializeAddon);
    try {
      const unicode11 = new Unicode11Addon();
      term.loadAddon(unicode11);
      term.unicode.activeVersion = "11";
    } catch {
      /* optional */
    }

    const container = containerRef.current;
    container.innerHTML = "";
    term.open(container);

    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* fall back to the DOM renderer */
    }

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;
    serializeAddonRef.current = serializeAddon;

    const disposedRef = {
      get current() {
        return disposed;
      },
    };

    // Copy on select.
    term.onSelectionChange(() => {
      const sel = term.getSelection();
      if (sel && sel.length > 0) {
        navigator.clipboard.writeText(sel).catch(() => {});
      }
    });

    // Paste on right-click.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) term.paste(text);
        })
        .catch(() => {});
    };
    container.addEventListener("contextmenu", onContextMenu);

    // Zoom shortcuts.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (!(e.ctrlKey || e.metaKey)) return true;
      if (e.key === "=" || e.key === "+") {
        zoom("in");
        return false;
      }
      if (e.key === "-") {
        zoom("out");
        return false;
      }
      if (e.key === "0") {
        zoom("reset");
        return false;
      }
      return true;
    });

    async function run() {
      if (disposed) return;

      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          safeFit();
          resolve();
        }),
      );
      if (disposed) return;

      // Replay the previous session's scrollback for context.
      try {
        const saved = localStorage.getItem(SCROLLBACK_PREFIX + server.id);
        if (saved) {
          term.write(
            `${C.dim}──── previous session ────${C.reset}\r\n` +
              saved +
              `\r\n${C.dim}─────────────────────────${C.reset}\r\n`,
          );
        }
      } catch {
        /* ignore */
      }

      writeSpacer(term, disposedRef);
      writeLine(
        term,
        disposedRef,
        `  ${C.bold}${C.blue}Watchtower${C.reset}  ${C.dim}${(server.protocol || "ssh").toUpperCase()} session${C.reset}`,
      );
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
      writeSpacer(term, disposedRef);

      const cols = term.cols;
      const rows = term.rows;

      let returnedId = "";

      // Trigger state (when-you-see-X-send-Y)
      const triggers = (server.advanced?.triggers ?? []).map((t) => ({
        re: (() => {
          try {
            return new RegExp(t.pattern);
          } catch {
            return null;
          }
        })(),
        send: t.send.replace(/\\n/g, "\n").replace(/\\t/g, "\t"),
        once: t.once,
        fired: false,
      }));
      let triggerTail = "";

      const maybeSendStartup = () => {
        if (startupSent || disposed || !returnedId) return;
        if (!server.advanced?.startup_command) return;
        startupSent = true;
        sshSendStartupCommand(returnedId, server.id).catch(() => {});
      };

      const dataChannel = new Channel<number[]>();
      dataChannel.onmessage = (data: number[]) => {
        if (disposed) return;
        const bytes = new Uint8Array(data);
        const text = decoder
          ? decoder.decode(bytes, { stream: true })
          : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        try {
          term.write(decoder ? text : bytes);
        } catch {
          /* disposed */
        }
        // Send the startup command only once the shell has produced output.
        if (!startupSent && server.advanced?.startup_command) {
          if (startupTimer) clearTimeout(startupTimer);
          startupTimer = setTimeout(maybeSendStartup, 500);
        }
        // Trigger matching against a rolling tail.
        if (triggers.length && returnedId) {
          triggerTail = (triggerTail + text).slice(-4096);
          for (const t of triggers) {
            if (!t.re || (t.once && t.fired)) continue;
            if (t.re.test(triggerTail)) {
              t.fired = true;
              termKindWrite(
                sessionKind,
                returnedId,
                Array.from(new TextEncoder().encode(t.send)),
              ).catch(() => {});
            }
          }
        }
      };

      const logChannel = new Channel<ConnectionLog>();
      logChannel.onmessage = (log: ConnectionLog) =>
        writeLog(term, disposedRef, log);

      const kbdChannel = new Channel<KbdPrompt>();
      kbdChannel.onmessage = (p: KbdPrompt) => {
        if (disposed) return;
        useKbdStore
          .getState()
          .setPending({ clientId, serverName: server.name, prompt: p });
      };

      writeLine(
        term,
        disposedRef,
        `  ${C.yellow}⧗${C.reset} Connecting to ${C.cyan}${server.host}:${server.port}${C.reset}…`,
      );

      const proto = (server.protocol || "ssh").toLowerCase();
      const sessionKind: "ssh" | "telnet" | "mosh" =
        proto === "telnet" ? "telnet" : proto === "mosh" ? "mosh" : "ssh";

      try {
        const t0 = performance.now();
        const adhoc = useAdhocStore.getState().get(server.id);
        if (sessionKind === "telnet") {
          returnedId = await telnetConnect(
            server.host,
            server.port,
            cols,
            rows,
            dataChannel,
            logChannel,
          );
        } else if (sessionKind === "mosh") {
          returnedId = await moshConnect(
            server.id,
            cols,
            rows,
            dataChannel,
            logChannel,
          );
        } else {
          returnedId = adhoc
            ? await sshConnectAdhoc(
                {
                  host: server.host,
                  port: server.port,
                  username: server.username,
                  authType: adhoc.authType,
                  password: adhoc.password,
                  keyPath: adhoc.keyPath,
                  passphrase: adhoc.passphrase,
                  cols,
                  rows,
                },
                dataChannel,
                logChannel,
              )
            : await sshConnect(
                server.id,
                clientId,
                cols,
                rows,
                dataChannel,
                logChannel,
                kbdChannel,
              );
        }

        if (disposed) return;
        if (!adhoc) vaultMarkConnected(server.id).catch(() => {});

        writeSpacer(term, disposedRef);
        writeLine(
          term,
          disposedRef,
          `  ${C.green}✓${C.reset} ${C.bold}Connected${C.reset}`,
        );
        writeSpacer(term, disposedRef);

        updateSession(sessionId, {
          status: "connected",
          backendId: returnedId,
          kind: sessionKind,
          latencyMs: Math.round(performance.now() - t0),
        });

        if (!server.icon && sessionKind === "ssh") {
          sshDetectOS(returnedId)
            .then((osId) => {
              const slug = osReleaseIdToSlug(osId);
              if (slug)
                updateServer({ id: server.id, icon: slug }).catch(() => {});
            })
            .catch(() => {});
        }

        {
          const { portForwardings } = useVaultStore.getState();
          const auto = portForwardings.filter(
            (r) => r.auto_start && r.server_id === server.id,
          );
          for (const r of auto) {
            tunnelStart(returnedId, {
              name: r.name,
              kind: r.rule_type,
              bind_host: r.local_host || "127.0.0.1",
              bind_port: r.local_port,
              target_host: r.remote_host,
              target_port: r.remote_port,
            }).catch(() => {});
          }
        }

        term.onData((data: string) => {
          if (disposed) return;
          const bytes = Array.from(new TextEncoder().encode(data));
          if (useUiStore.getState().broadcastInput) {
            const targets = useSessionStore
              .getState()
              .sessions.filter((s) => s.status === "connected" && s.backendId);
            for (const t of targets)
              termKindWrite(t.kind, t.backendId!, bytes).catch(() => {});
          } else {
            termKindWrite(sessionKind, returnedId, bytes).catch(() => {});
          }
        });

        term.onResize(({ cols, rows }) => {
          if (disposed) return;
          termKindResize(sessionKind, returnedId, cols, rows).catch(() => {});
        });

        term.focus();
        // Fallback: if the server sends nothing, still run the startup command.
        if (server.advanced?.startup_command) {
          setTimeout(maybeSendStartup, 2500);
        }
      } catch (e) {
        if (disposed) return;
        const errMsg = String(e);
        writeSpacer(term, disposedRef);
        writeLine(term, disposedRef, `  ${C.red}✗ Connection failed${C.reset}`);
        writeLine(term, disposedRef, `  ${C.dim}${errMsg}${C.reset}`);
        writeSpacer(term, disposedRef);
        updateSession(sessionId, { status: "error", error: errMsg });

        const hk = errMsg.match(
          /HOSTKEY_(UNKNOWN|MISMATCH) (\S+) (\S+)(?: (\S+))?/,
        );
        if (hk) {
          handleHostKeyPrompt(hk, server, () => {
            useSessionStore.getState().removeSession(sessionId);
            connectServer(server);
          });
        } else {
          addToast({
            title: "Connection failed",
            description: errMsg,
            variant: "destructive",
          });
        }
      }
    }

    run();

    return () => {
      disposed = true;
      if (startupTimer) clearTimeout(startupTimer);
      if (useKbdStore.getState().pending?.clientId === clientId) {
        sshSubmitKbd(clientId, null).catch(() => {});
        useKbdStore.getState().setPending(null);
      }
      container.removeEventListener("contextmenu", onContextMenu);
      try {
        const dump = serializeAddon.serialize({ scrollback: 2000 });
        if (dump.trim())
          localStorage.setItem(
            SCROLLBACK_PREFIX + server.id,
            dump.slice(-60000),
          );
      } catch {
        /* ignore */
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      serializeAddonRef.current = null;
    };
  }, [
    sessionId,
    server.id,
    server.host,
    server.port,
    server.username,
    server.auth_type,
    server.protocol,
  ]);

  const themeKey = useUiStore((s) => s.theme);
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = terminalPalette(themeKey);
    }
  }, [themeKey]);

  useEffect(() => {
    window.addEventListener("resize", safeFit);
    const ro = new ResizeObserver(safeFit);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      window.removeEventListener("resize", safeFit);
      ro.disconnect();
    };
  }, [safeFit]);

  return { containerRef, termRef, safeFit, searchAddonRef, clearBuffer, zoom };
}
