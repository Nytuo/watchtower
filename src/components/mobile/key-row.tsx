import { useMobileStore } from "@/stores/mobile-store";

const KEYS: { label: string; data: string }[] = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "Home", data: "\x1b[H" },
  { label: "End", data: "\x1b[F" },
  { label: "PgUp", data: "\x1b[5~" },
  { label: "PgDn", data: "\x1b[6~" },
  { label: "^C", data: "\x03" },
  { label: "^D", data: "\x04" },
  { label: "^Z", data: "\x1a" },
  { label: "^L", data: "\x0c" },
];

function send(sessionId: string, data: string) {
  window.dispatchEvent(
    new CustomEvent("wt-term-input", { detail: { sessionId, data } }),
  );
}

export function KeyRow({ sessionId }: { sessionId: string }) {
  const ctrl = useMobileStore((s) => s.ctrl);
  const alt = useMobileStore((s) => s.alt);
  const setCtrl = useMobileStore((s) => s.setCtrl);
  const setAlt = useMobileStore((s) => s.setAlt);

  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const base =
    "shrink-0 select-none rounded-md border border-border px-3 py-2 text-xs font-medium active:bg-accent";

  return (
    <div
      className="flex gap-1.5 overflow-x-auto border-t border-border bg-sidebar px-2 py-1.5"
      style={{ scrollbarWidth: "none" }}
    >
      <button
        onPointerDown={keep}
        onClick={() => setCtrl(!ctrl)}
        className={`${base} ${ctrl ? "bg-primary text-primary-foreground" : ""}`}
      >
        Ctrl
      </button>
      <button
        onPointerDown={keep}
        onClick={() => setAlt(!alt)}
        className={`${base} ${alt ? "bg-primary text-primary-foreground" : ""}`}
      >
        Alt
      </button>
      {KEYS.map((k) => (
        <button
          key={k.label}
          onPointerDown={keep}
          onClick={() => send(sessionId, k.data)}
          className={base}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
