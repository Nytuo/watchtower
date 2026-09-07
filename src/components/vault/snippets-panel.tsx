import React, { useMemo, useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { runSnippet } from "@/stores/snippet-run-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { destructiveReason } from "@/lib/snippets";
import {
  Plus,
  Pencil,
  Trash2,
  Code,
  X,
  Save,
  Copy,
  Play,
  ClipboardPaste,
  Pin,
  PinOff,
  Search,
  AlertTriangle,
} from "lucide-react";
import type { SnippetRunMode } from "@/lib/tauri";

export function SnippetsPanel() {
  const { snippets, tags, addSnippet, updateSnippet, deleteSnippet } =
    useVaultStore();
  const { addToast } = useUiStore();
  const { sessions } = useSessionStore();

  const hasSession = sessions.some(
    (s) => s.status === "connected" && s.backendId,
  );

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [runMode, setRunMode] = useState<SnippetRunMode>("paste");
  const [confirmBeforeRun, setConfirmBeforeRun] = useState(false);
  const [shell, setShell] = useState("");
  const [os, setOs] = useState("");

  const resetForm = () => {
    setName("");
    setContent("");
    setDescription("");
    setSelectedTags([]);
    setRunMode("paste");
    setConfirmBeforeRun(false);
    setShell("");
    setOs("");
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (id: string) => {
    const s = snippets.find((x) => x.id === id);
    if (!s) return;
    setName(s.name);
    setContent(s.content);
    setDescription(s.description || "");
    setSelectedTags(s.tags);
    setRunMode(s.run_mode);
    setConfirmBeforeRun(s.confirm_before_run);
    setShell(s.shell || "");
    setOs(s.os || "");
    setEditing(id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const common = {
        name,
        content,
        description: description || undefined,
        tags: selectedTags,
        runMode,
        confirmBeforeRun,
        shell: shell || undefined,
        os: os || undefined,
      };
      if (editing) {
        await updateSnippet({ id: editing, ...common });
        addToast({ title: "Snippet updated" });
      } else {
        await addSnippet(common);
        addToast({ title: "Snippet created" });
      }
      resetForm();
    } catch (err) {
      addToast({
        title: "Error",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSnippet(id);
      addToast({ title: "Snippet deleted" });
    } catch (err) {
      addToast({
        title: "Error",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const togglePin = async (id: string, pinned: boolean) => {
    try {
      await updateSnippet({ id, pinned: !pinned });
    } catch (err) {
      addToast({
        title: "Error",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      addToast({ title: "Copied to clipboard" });
    });
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId],
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...snippets]
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.usage_count - a.usage_count ||
          a.order - b.order ||
          a.name.localeCompare(b.name),
      );
  }, [snippets, search]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold">Command Snippets</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Save commands and send them to the active terminal. Use{" "}
            <code>{"{{host}}"}</code>, <code>{"{{user}}"}</code>,{" "}
            <code>{"{{port}}"}</code>, or <code>{'{{prompt:"Label"}}'}</code>{" "}
            placeholders. Press <kbd>⌘K</kbd> for the quick runner.
          </p>
        </div>

        {snippets.length > 3 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter snippets…"
              className="h-8 pl-8 text-sm"
            />
          </div>
        )}

        <div className="space-y-3">
          {snippets.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-10">
              <Code className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No snippets yet</p>
            </div>
          )}

          {filtered.map((snippet) => {
            const danger = destructiveReason(snippet.content);
            return (
              <div
                key={snippet.id}
                className="border border-border rounded-md p-3 space-y-2 group"
              >
                <div className="flex items-center gap-2">
                  <button
                    title={snippet.pinned ? "Unpin" : "Pin"}
                    onClick={() => togglePin(snippet.id, snippet.pinned)}
                    className={
                      snippet.pinned
                        ? "text-primary"
                        : "text-muted-foreground opacity-0 group-hover:opacity-100"
                    }
                  >
                    {snippet.pinned ? (
                      <Pin className="h-3.5 w-3.5" />
                    ) : (
                      <PinOff className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <span className="text-sm font-medium flex-1 truncate">
                    {snippet.name}
                  </span>
                  {danger && (
                    <AlertTriangle
                      className="h-3.5 w-3.5 text-destructive"
                      aria-label={`destructive: ${danger}`}
                    />
                  )}
                  {snippet.usage_count > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      ×{snippet.usage_count}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!hasSession}
                    title="Paste into terminal"
                    onClick={() => runSnippet(snippet, { mode: "paste" })}
                  >
                    <ClipboardPaste className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={!hasSession}
                    title="Run in terminal"
                    onClick={() => runSnippet(snippet, { mode: "run" })}
                  >
                    <Play className="h-3.5 w-3.5 text-green-500" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => handleCopy(snippet.content)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => handleEdit(snippet.id)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => handleDelete(snippet.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
                <pre className="text-xs bg-background/50 rounded p-2 font-mono overflow-x-auto">
                  {snippet.content}
                </pre>
                {snippet.description && (
                  <p className="text-xs text-muted-foreground">
                    {snippet.description}
                  </p>
                )}
              </div>
            );
          })}

          {showForm ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-3 border border-border rounded-md p-3"
            >
              <div className="space-y-2">
                <Label htmlFor="sname">Name</Label>
                <Input
                  id="sname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Snippet name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scontent">Command</Label>
                <Textarea
                  id="scontent"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="sudo systemctl restart {{service}}"
                  rows={3}
                  className="font-mono text-xs"
                  required
                />
                {destructiveReason(content) && (
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Looks destructive ({destructiveReason(content)}) — a
                    confirmation will be required.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="sdesc">Description (optional)</Label>
                <Input
                  id="sdesc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this command does"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Default action</Label>
                  <Select
                    value={runMode}
                    onChange={(e) =>
                      setRunMode(e.target.value as SnippetRunMode)
                    }
                    options={[
                      { value: "paste", label: "Paste (no newline)" },
                      { value: "run", label: "Run (press Enter)" },
                    ]}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Shell hint (optional)</Label>
                  <Input
                    value={shell}
                    onChange={(e) => setShell(e.target.value)}
                    placeholder="bash, zsh, fish…"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmBeforeRun}
                  onChange={(e) => setConfirmBeforeRun(e.target.checked)}
                  className="rounded border-border"
                />
                Always confirm before running
              </label>
              {tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={`px-2 py-0.5 rounded-full text-xs border ${
                          selectedTags.includes(tag.id)
                            ? "border-primary bg-accent"
                            : "border-border text-muted-foreground"
                        }`}
                        onClick={() => toggleTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  <Save className="mr-1 h-3.5 w-3.5" />
                  {editing ? "Update" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={resetForm}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Snippet
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
