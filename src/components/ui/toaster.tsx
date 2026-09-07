import { useState } from "react";
import { useUiStore } from "@/stores/ui-store";
import { X, Copy, ChevronDown, ChevronUp } from "lucide-react";

export function Toaster() {
  const { toasts, removeToast } = useUiStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[100] flex max-w-md flex-col gap-2">
      {toasts.map((toast) => {
        const isErr = toast.variant === "destructive";
        const long = (toast.description?.length ?? 0) > 140;
        const open = expanded[toast.id];
        return (
          <div
            key={toast.id}
            className={`flex items-start gap-3 rounded-lg border p-3 shadow-lg animate-in slide-in-from-right ${
              isErr
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border bg-card text-card-foreground"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{toast.title}</div>
              {toast.description && (
                <div
                  className={`mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground ${
                    long && !open ? "line-clamp-3" : "max-h-60 overflow-y-auto"
                  }`}
                >
                  {toast.description}
                </div>
              )}
              {toast.progress !== undefined && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${toast.progress}%` }}
                  />
                </div>
              )}
              {(long || isErr) && toast.description && (
                <div className="mt-1.5 flex items-center gap-3">
                  {long && (
                    <button
                      className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [toast.id]: !e[toast.id] }))
                      }
                    >
                      {open ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                      {open ? "less" : "more"}
                    </button>
                  )}
                  <button
                    className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(
                          `${toast.title}\n${toast.description ?? ""}`.trim(),
                        )
                        .catch(() => {})
                    }
                  >
                    <Copy className="h-3 w-3" />
                    copy
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
