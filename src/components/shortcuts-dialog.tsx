import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui-store";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Global",
    items: [
      ["⌘/Ctrl + K", "Command palette (snippets, servers, actions)"],
      ["?", "This shortcuts sheet"],
      ["⌘/Ctrl + Shift + P", "Command palette"],
    ],
  },
  {
    title: "Terminal",
    items: [
      ["⌘/Ctrl + F", "Search the terminal buffer"],
      ["⌘/Ctrl + = / -", "Zoom in / out"],
      ["⌘/Ctrl + 0", "Reset zoom"],
      ["Right-click", "Paste from clipboard"],
      ["Select text", "Copy to clipboard"],
      ["Double-click a tab", "Rename the tab"],
    ],
  },
  {
    title: "Files",
    items: [
      ["Drag a row to the other pane", "Transfer that file"],
      ["Click the path", "Jump to a path"],
      ["Double-click a folder", "Open it"],
    ],
  },
];

export function ShortcutsDialog() {
  const { showShortcuts, setShowShortcuts } = useUiStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        t?.tagName === "INPUT" ||
        t?.tagName === "TEXTAREA" ||
        t?.isContentEditable;
      if (!typing && e.key === "?") {
        e.preventDefault();
        setShowShortcuts(!useUiStore.getState().showShortcuts);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setShowShortcuts]);

  if (!showShortcuts) return null;

  return (
    <Dialog open onClose={() => setShowShortcuts(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.title}
              </h3>
              <div className="space-y-1.5">
                {g.items.map(([k, desc]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span className="text-muted-foreground">{desc}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {k}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
