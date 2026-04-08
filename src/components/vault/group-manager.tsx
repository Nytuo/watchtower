import React, { useState } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, FolderOpen, X, Save } from "lucide-react";

const ICONS = ["📁", "🖥️", "☁️", "🏠", "🏢", "🌐", "🔒", "⚡", "🐳", "🔧"];
const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function GroupManager() {
  const { groups, addGroup, updateGroup, deleteGroup } = useVaultStore();
  const { addToast } = useUiStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [parentId, setParentId] = useState("");
  const [showForm, setShowForm] = useState(false);

  const resetForm = () => {
    setName("");
    setColor("");
    setIcon("");
    setParentId("");
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (id: string) => {
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    setName(group.name);
    setColor(group.color || "");
    setIcon(group.icon || "");
    setParentId(group.parent_id || "");
    setEditing(id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await updateGroup(editing, {
          name: name || undefined,
          color: color || undefined,
          icon: icon || undefined,
          parentId: parentId || undefined,
        });
        addToast({ title: "Group updated" });
      } else {
        await addGroup(name, {
          color: color || undefined,
          icon: icon || undefined,
          parentId: parentId || undefined,
        });
        addToast({ title: "Group created" });
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
      await deleteGroup(id);
      addToast({ title: "Group deleted" });
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
          <h2 className="text-base font-semibold">Server Groups</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Organize your servers into groups.
          </p>
        </div>

        <div className="space-y-3">
          {groups.length === 0 && !showForm && (
            <div className="text-center text-muted-foreground py-10">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No groups yet</p>
            </div>
          )}

          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md border border-border"
            >
              {group.icon && <span className="text-base">{group.icon}</span>}
              <div
                className="h-4 w-1 rounded-full shrink-0"
                style={{ backgroundColor: group.color || "hsl(0 0% 30%)" }}
              />
              <span className="flex-1 text-sm font-medium">{group.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleEdit(group.id)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => handleDelete(group.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          {showForm ? (
            <form
              onSubmit={handleSubmit}
              className="space-y-3 border border-border rounded-md p-3"
            >
              <div className="space-y-2">
                <Label htmlFor="gname">Name</Label>
                <Input
                  id="gname"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Group name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ICONS.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      className={`h-7 w-7 rounded text-sm flex items-center justify-center ${icon === ic ? "border border-primary bg-accent" : "hover:bg-accent/50"}`}
                      onClick={() => setIcon(icon === ic ? "" : ic)}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
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
              Add Group
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
