import React, { useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, Tag as TagIcon, X, Save } from "lucide-react";

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

export function TagManager() {
  const { tags, addTag, updateTag, deleteTag } = useVaultStore();
  const { addToast } = useUiStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [showForm, setShowForm] = useState(false);

  const resetForm = () => {
    setName("");
    setColor("");
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (id: string) => {
    const tag = tags.find((t) => t.id === id);
    if (!tag) return;
    setName(tag.name);
    setColor(tag.color || "");
    setEditing(id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateTag(editing, name || undefined, color || undefined);
        addToast({ title: "Tag updated" });
      } else {
        await addTag(name, color || undefined);
        addToast({ title: "Tag created" });
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
      await deleteTag(id);
      addToast({ title: "Tag deleted" });
    } catch (e) {
      addToast({
        title: "Error",
        description: String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h2 className="text-base font-semibold">Tags</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage tags for organizing servers and snippets.
          </p>
        </div>

        <div className="space-y-3">
          {tags.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-10">
              <TagIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No tags yet</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border group"
                style={
                  tag.color ? { borderColor: tag.color + "80" } : undefined
                }
              >
                {tag.color && (
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                )}
                <span className="text-xs font-medium">{tag.name}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                  onClick={() => handleEdit(tag.id)}
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive"
                  onClick={() => handleDelete(tag.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {showForm ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-3 border border-border rounded-md p-3"
            >
              <div className="space-y-2">
                <Label htmlFor="tname">Name</Label>
                <Input
                  id="tname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Tag name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-white scale-110" : "border-transparent hover:border-white/50"}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(color === c ? "" : c)}
                    />
                  ))}
                </div>
              </div>
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
              Add Tag
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
