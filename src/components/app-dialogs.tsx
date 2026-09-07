import { useEffect, useRef, useState } from "react";
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
import { useDialogStore } from "@/stores/dialog-store";

export function AppDialogs() {
  const { current, _done } = useDialogStore();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setValue(current.defaultValue ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [current]);

  if (!current) return null;

  const close = (result: boolean | string | null) => {
    if (current.kind === "confirm") current.resolve(result as boolean);
    else current.resolve(result as string | null);
    _done();
  };

  return (
    <Dialog
      open
      onClose={() => close(current.kind === "confirm" ? false : null)}
      className="max-w-md"
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          {current.message && (
            <DialogDescription className="whitespace-pre-wrap">
              {current.message}
            </DialogDescription>
          )}
        </DialogHeader>

        {current.kind === "prompt" && (
          <DialogBody>
            <Input
              ref={inputRef}
              value={value}
              placeholder={current.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") close(value);
                if (e.key === "Escape") close(null);
              }}
            />
          </DialogBody>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => close(current.kind === "confirm" ? false : null)}
          >
            {current.kind === "confirm"
              ? (current.cancelLabel ?? "Cancel")
              : "Cancel"}
          </Button>
          <Button
            variant={
              current.kind === "confirm" && current.danger
                ? "destructive"
                : "default"
            }
            onClick={() => close(current.kind === "confirm" ? true : value)}
          >
            {current.kind === "confirm"
              ? (current.confirmLabel ?? "Confirm")
              : "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
