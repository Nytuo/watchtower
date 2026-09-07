import { useEffect, useState } from "react";
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
import { ShieldCheck } from "lucide-react";
import { useKbdStore } from "@/stores/kbd-store";
import { sshSubmitKbd } from "@/lib/tauri";

export function KbdPromptDialog() {
  const { pending, setPending } = useKbdStore();
  const [values, setValues] = useState<string[]>([]);

  useEffect(() => {
    if (pending) setValues(pending.prompt.prompts.map(() => ""));
  }, [pending]);

  if (!pending) return null;

  const { prompt } = pending;

  const submit = () => {
    sshSubmitKbd(pending.clientId, values).catch(() => {});
    setPending(null);
  };
  const cancel = () => {
    sshSubmitKbd(pending.clientId, null).catch(() => {});
    setPending(null);
  };

  return (
    <Dialog open onClose={cancel} className="max-w-md">
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {prompt.name || "Verification required"}
          </DialogTitle>
          <DialogDescription>
            {pending.serverName}
            {prompt.instructions ? ` — ${prompt.instructions}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {prompt.prompts.map((p, i) => (
            <div key={i} className="space-y-1.5">
              <Label>{p.prompt.replace(/:\s*$/, "")}</Label>
              <Input
                autoFocus={i === 0}
                type={p.echo ? "text" : "password"}
                value={values[i] ?? ""}
                onChange={(e) =>
                  setValues((v) => {
                    const n = [...v];
                    n[i] = e.target.value;
                    return n;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
            </div>
          ))}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button onClick={submit}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
