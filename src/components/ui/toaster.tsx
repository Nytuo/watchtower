import { useUiStore } from "@/stores/ui-store";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-lg border p-4 shadow-lg transition-all animate-in slide-in-from-right ${
            toast.variant === "destructive"
              ? "border-destructive/50 bg-destructive/10 text-destructive"
              : "border-border bg-card text-card-foreground"
          }`}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{toast.title}</div>
            {toast.description && (
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {toast.description}
              </div>
            )}
            {toast.progress !== undefined && (
              <div className="mt-2 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${toast.progress}%` }}
                />
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
      ))}
    </div>
  );
}
