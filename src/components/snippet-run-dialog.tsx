import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Play, ClipboardPaste } from "lucide-react";
import { useSnippetRunStore } from "@/stores/snippet-run-store";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import {
  destructiveReason,
  interpolate,
  parseVars,
  sendToTerminal,
  systemVars,
} from "@/lib/snippets";

export function SnippetRunDialog() {
  const { pending, clear } = useSnippetRunStore();
  const { servers, touchSnippet } = useVaultStore();
  const { addToast } = useUiStore();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const server = pending
    ? servers.find((s) => s.id === pending.serverId)
    : undefined;

  const sys = useMemo(() => systemVars(server), [server]);

  const promptVars = useMemo(() => {
    if (!pending) return [];
    const seen = new Set<string>();
    return parseVars(pending.snippet.content).filter((v) => {
      if (v.name in sys || v.name.toLowerCase() in sys) return false;
      if (seen.has(v.name)) return false;
      seen.add(v.name);
      return true;
    });
  }, [pending, sys]);

  useEffect(() => {
    if (pending) {
      const init: Record<string, string> = {};
      for (const v of parseVars(pending.snippet.content)) {
        if (!(v.name in sys)) init[v.name] = v.defaultValue;
      }
      setValues(init);
    }
  }, [pending, sys]);

  if (!pending) return null;

  const danger = destructiveReason(pending.snippet.content);
  const preview = interpolate(pending.snippet.content, { ...sys, ...values });
  const canRun = promptVars.every(
    (v) => (values[v.name] ?? "").length > 0 || v.defaultValue.length > 0,
  );

  const execute = async (mode: "run" | "paste") => {
    setBusy(true);
    try {
      await sendToTerminal(pending.backendId, preview, mode === "run");
      touchSnippet(pending.snippet.id);
      addToast({ title: `Snippet "${pending.snippet.name}" sent` });
      clear();
    } catch (e) {
      addToast({
        title: "Snippet failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={clear}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pending.snippet.name}</DialogTitle>
          {pending.snippet.description && (
            <DialogDescription>{pending.snippet.description}</DialogDescription>
          )}
        </DialogHeader>

        <DialogBody className="space-y-4">
          {danger && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This command looks destructive ({danger}). Review it carefully
                before running.
              </span>
            </div>
          )}

          {promptVars.length > 0 && (
            <div className="space-y-3">
              {promptVars.map((v) => (
                <div key={v.name} className="space-y-1.5">
                  <Label>{v.label}</Label>
                  <Input
                    autoFocus={promptVars[0].name === v.name}
                    value={values[v.name] ?? ""}
                    placeholder={v.defaultValue || v.name}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [v.name]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Preview</Label>
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap">
              {preview}
            </pre>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={clear} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => execute("paste")}
            disabled={busy || !canRun}
          >
            <ClipboardPaste className="mr-1.5 h-4 w-4" />
            Paste
          </Button>
          <Button onClick={() => execute("run")} disabled={busy || !canRun}>
            <Play className="mr-1.5 h-4 w-4" />
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
