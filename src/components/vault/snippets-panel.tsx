import React, { useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Code, X, Save, Copy } from "lucide-react";

export function SnippetsPanel() {
  const { snippets, tags, addSnippet, updateSnippet, deleteSnippet } =
    useVaultStore();
  const { addToast } = useUiStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);

  const resetForm = () => {
    setName("");
    setContent("");
    setDescription("");
    setSelectedTags([]);
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (id: string) => {
    const snippet = snippets.find((s) => s.id === id);
    if (!snippet) return;
    setName(snippet.name);
    setContent(snippet.content);
    setDescription(snippet.description || "");
    setSelectedTags(snippet.tags);
    setEditing(id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateSnippet({
          id: editing,
          name: name || undefined,
          content: content || undefined,
          description: description || undefined,
          tags: selectedTags,
        });
        addToast({ title: "Snippet updated" });
      } else {
        await addSnippet({
          name,
          content,
          description: description || undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
        });
        addToast({ title: "Snippet created" });
      }
      resetForm();
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSnippet(id);
      addToast({ title: "Snippet deleted" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold">Command Snippets</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Save and reuse frequently used commands.
          </p>
        </div>

        <div className="space-y-3">
          {snippets.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-10">
              <Code className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No snippets yet</p>
            </div>
          )}

          {snippets.map((snippet) => (
            <div
              key={snippet.id}
              className="border border-border rounded-md p-3 space-y-2 group"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium flex-1">
                  {snippet.name}
                </span>
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
          ))}

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
                  placeholder="sudo systemctl restart nginx"
                  rows={3}
                  className="font-mono text-xs"
                  required
                />
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
              {tags.length > 0 && (
                <div className="space-y-2">
                  <Label>Tags</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        className={`px-2 py-0.5 rounded-full text-xs border ${selectedTags.includes(tag.id) ? "border-primary bg-accent" : "border-border text-muted-foreground"}`}
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
