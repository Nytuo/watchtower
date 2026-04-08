import { sshWrite, type ServerInfo, type Snippet } from "@/lib/tauri";

const DESTRUCTIVE_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, label: "recursive/forced rm" },
  { re: /\brm\s+-[a-z]*r/i, label: "recursive rm" },
  { re: /\bmkfs(\.\w+)?\b/i, label: "filesystem format" },
  { re: /\bdd\s+.*of=\/dev\//i, label: "raw disk write" },
  { re: />\s*\/dev\/[sh]d[a-z]/i, label: "write to block device" },
  {
    re: /\b(shutdown|reboot|halt|poweroff|init\s+0)\b/i,
    label: "shutdown/reboot",
  },
  { re: /:\(\)\s*\{.*\}\s*;/, label: "fork bomb" },
  { re: /\bchmod\s+-R\s+0?777\s+\//, label: "chmod 777 on /" },
  { re: /\b(drop\s+database|truncate\s+table)\b/i, label: "destructive SQL" },
  {
    re: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force)/i,
    label: "destructive git",
  },
  { re: /\biptables\s+-F\b/i, label: "flush firewall" },
];

export function destructiveReason(content: string): string | null {
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(content)) return p.label;
  }
  return null;
}

const VAR_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface SnippetVar {
  token: string;
  name: string;
  label: string;
  prompt: boolean;
  defaultValue: string;
}

export function parseVars(content: string): SnippetVar[] {
  const seen = new Map<string, SnippetVar>();
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(content))) {
    const raw = m[1].trim();
    let name = raw;
    let prompt = false;
    let label = raw;
    let defaultValue = "";

    if (raw.startsWith("prompt:") || raw.startsWith("prompt ")) {
      prompt = true;
      const rest = raw
        .slice(7)
        .trim()
        .replace(/^["']|["']$/g, "");
      const eq = rest.indexOf("=");
      if (eq >= 0) {
        label = rest.slice(0, eq).trim();
        defaultValue = rest.slice(eq + 1).trim();
      } else {
        label = rest;
      }
      name = label;
    } else if (raw.includes("=")) {
      const eq = raw.indexOf("=");
      name = raw.slice(0, eq).trim();
      defaultValue = raw.slice(eq + 1).trim();
      label = name;
      prompt = true;
    }

    if (!seen.has(m[0])) {
      seen.set(m[0], { token: m[0], name, label, prompt, defaultValue });
    }
  }
  return [...seen.values()];
}

export function systemVars(
  server: ServerInfo | undefined,
): Record<string, string> {
  if (!server) return {};
  return {
    host: server.host,
    hostname: server.host,
    user: server.username,
    username: server.username,
    port: String(server.port),
    name: server.name,
    server: server.name,
  };
}

export function interpolate(
  content: string,
  values: Record<string, string>,
): string {
  return content.replace(VAR_RE, (whole, rawInner) => {
    const raw = String(rawInner).trim();
    let key = raw;
    if (raw.startsWith("prompt:") || raw.startsWith("prompt ")) {
      key = raw
        .slice(7)
        .trim()
        .replace(/^["']|["']$/g, "")
        .split("=")[0]
        .trim();
    } else if (raw.includes("=")) {
      key = raw.slice(0, raw.indexOf("=")).trim();
    }
    if (key in values && values[key] !== "") return values[key];
    const sys = raw.toLowerCase();
    if (sys in values) return values[sys];
    return whole;
  });
}

export function unresolvedVars(
  snippet: Snippet,
  server: ServerInfo | undefined,
): SnippetVar[] {
  const sys = systemVars(server);
  return parseVars(snippet.content).filter(
    (v) => !(v.name in sys) && !(v.name.toLowerCase() in sys),
  );
}

export async function sendToTerminal(
  backendId: string,
  text: string,
  run: boolean,
) {
  const payload = run ? text.replace(/\n?$/, "\n") : text;
  await sshWrite(backendId, Array.from(new TextEncoder().encode(payload)));
}
