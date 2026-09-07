import { useMemo } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useSessionStore } from "@/stores/session-store";
import { runSnippet } from "@/stores/snippet-run-store";
import { Code2 } from "lucide-react";

export function SnippetBar() {
  const snippets = useVaultStore((s) => s.snippets);
  const pinned = useMemo(() => snippets.filter((x) => x.pinned), [snippets]);
  const { sessions, activeSessionId } = useSessionStore();

  const active = sessions.find((s) => s.id === activeSessionId);
  const ready = active?.status === "connected" && !!active.backendId;

  if (pinned.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-background px-2 py-1">
      <Code2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {pinned.map((s) => (
        <button
          key={s.id}
          disabled={!ready}
          title={s.content}
          onClick={() => runSnippet(s, { backendId: active?.backendId })}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
