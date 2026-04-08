import React, { useState, useCallback } from "react";
import { useVaultStore } from "@/stores/vault-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  KeyRound,
  Save,
  Eye,
  EyeOff,
  RefreshCw,
  Copy,
  Check,
  Lock,
  FileKey,
  ShieldCheck,
} from "lucide-react";
import { generateSshKey } from "@/lib/tauri";
import type { CredentialType, KeychainEntry } from "@/lib/tauri";

function credLabel(cred: CredentialType): string {
  switch (cred.type) {
    case "password":
      return `Password · ${cred.username}`;
    case "ssh_key":
      return `SSH Key · ${cred.key_type.toUpperCase()}`;
    case "certificate":
      return "Certificate";
    case "fido":
      return "FIDO / Hardware Key";
    case "touch_id":
      return "Touch ID";
  }
}

function credIcon(cred: CredentialType) {
  switch (cred.type) {
    case "password":
      return <Lock className="h-4 w-4" />;
    case "ssh_key":
      return <KeyRound className="h-4 w-4" />;
    case "certificate":
      return <ShieldCheck className="h-4 w-4" />;
    default:
      return <FileKey className="h-4 w-4" />;
  }
}

interface FormState {
  name: string;
  credType: "password" | "ssh_key" | "certificate";

  credUsername: string;
  credPassword: string;

  keyType: string;
  privateKey: string;
  publicKey: string;
  passphrase: string;

  certificate: string;
  certKey: string;
}

const emptyForm = (): FormState => ({
  name: "",
  credType: "password",
  credUsername: "",
  credPassword: "",
  keyType: "ed25519",
  privateKey: "",
  publicKey: "",
  passphrase: "",
  certificate: "",
  certKey: "",
});

function formFromEntry(entry: KeychainEntry): FormState {
  const base = emptyForm();
  base.name = entry.name;
  const c = entry.credential;
  if (c.type === "password") {
    base.credType = "password";
    base.credUsername = c.username;
    base.credPassword = c.password;
  } else if (c.type === "ssh_key") {
    base.credType = "ssh_key";
    base.keyType = c.key_type;
    base.privateKey = c.private_key;
    base.publicKey = c.public_key ?? "";
    base.passphrase = c.passphrase ?? "";
  } else if (c.type === "certificate") {
    base.credType = "certificate";
    base.certificate = c.certificate;
    base.certKey = c.private_key ?? "";
    base.passphrase = c.passphrase ?? "";
  }
  return base;
}

function buildCredential(f: FormState): CredentialType {
  switch (f.credType) {
    case "password":
      return {
        type: "password",
        username: f.credUsername,
        password: f.credPassword,
      };
    case "ssh_key":
      return {
        type: "ssh_key",
        private_key: f.privateKey,
        public_key: f.publicKey || undefined,
        passphrase: f.passphrase || undefined,
        key_type: f.keyType,
      };
    case "certificate":
      return {
        type: "certificate",
        certificate: f.certificate,
        private_key: f.certKey || undefined,
        passphrase: f.passphrase || undefined,
      };
  }
}

export function KeychainManager() {
  const { keychains, addKeychain, updateKeychain, deleteKeychain } =
    useVaultStore();
  const { addToast } = useUiStore();

  const [selected, setSelected] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);

  const [copied, setCopied] = useState<"pub" | "priv" | null>(null);

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectEntry = (entry: KeychainEntry) => {
    setSelected(entry.id);
    setForm(formFromEntry(entry));
    setShowPassword(false);
    setShowPassphrase(false);
  };

  const startNew = () => {
    setSelected("new");
    setForm(emptyForm());
    setShowPassword(false);
    setShowPassphrase(false);
  };

  const cancel = () => {
    setSelected(null);
    setForm(emptyForm());
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (selected === "new") {
        await addKeychain(form.name.trim(), buildCredential(form));
        addToast({ title: "Keychain entry created" });
      } else if (selected) {
        await updateKeychain(selected, form.name.trim(), buildCredential(form));
        addToast({ title: "Keychain entry updated" });
      }
      setSelected(null);
      setForm(emptyForm());
    } catch (err) {
      addToast({
        title: "Error",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteKeychain(id);
      addToast({ title: "Keychain entry deleted" });
      if (selected === id) {
        setSelected(null);
        setForm(emptyForm());
      }
    } catch (err) {
      addToast({
        title: "Error",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const kt = form.keyType === "rsa" ? "rsa" : "ed25519";
      const res = await generateSshKey({
        keyType: kt,
        bits: kt === "rsa" ? 4096 : undefined,
        comment: form.name.trim() || undefined,
        passphrase: form.passphrase || undefined,
      });
      setForm((f) => ({
        ...f,
        keyType: res.key_type,
        privateKey: res.private_key,
        publicKey: res.public_key,
      }));
      addToast({ title: "Key generated", description: res.fingerprint });
    } catch (e) {
      addToast({
        title: "Key generation failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  }, [addToast, form.keyType, form.name, form.passphrase]);

  const copyToClipboard = async (text: string, which: "pub" | "priv") => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const filteredKeychains = keychains.filter((k) =>
    k.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col w-[240px] shrink-0 border-r border-border overflow-hidden">
        <div className="px-4 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Keychain</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            SSH credentials &amp; passwords
          </p>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border shrink-0">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="h-7 text-xs flex-1"
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={startNew}
            title="New entry"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {filteredKeychains.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
              <KeyRound className="h-7 w-7 opacity-30" />
              <p className="text-xs text-center">
                {keychains.length === 0
                  ? "No entries yet.\nClick + to add one."
                  : "No matches."}
              </p>
            </div>
          ) : (
            filteredKeychains.map((entry) => (
              <button
                key={entry.id}
                onClick={() => selectEntry(entry)}
                className={[
                  "group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  selected === entry.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-foreground",
                ].join(" ")}
              >
                <span className="shrink-0 text-muted-foreground">
                  {credIcon(entry.credential)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {entry.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {credLabel(entry.credential)}
                  </div>
                </div>
                <button
                  className="shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(entry.id);
                  }}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selected === null ? (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Select an entry or click{" "}
            <button
              onClick={startNew}
              className="mx-1 text-foreground underline underline-offset-2"
            >
              + New
            </button>{" "}
            to create one.
          </div>
        ) : (
          <form
            onSubmit={handleSave}
            className="flex flex-col gap-4 p-5 max-w-lg"
          >
            <h3 className="text-sm font-semibold">
              {selected === "new" ? "New Entry" : "Edit Entry"}
            </h3>

            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="My SSH Key"
                required
                className="h-8 text-sm"
              />
            </Field>

            <Field label="Type">
              <Select
                value={form.credType}
                onChange={(e) =>
                  setField("credType", e.target.value as FormState["credType"])
                }
                options={[
                  { value: "password", label: "Password" },
                  { value: "ssh_key", label: "SSH Key" },
                  { value: "certificate", label: "Certificate" },
                ]}
              />
            </Field>

            {form.credType === "password" && (
              <>
                <Field label="Username">
                  <Input
                    value={form.credUsername}
                    onChange={(e) => setField("credUsername", e.target.value)}
                    placeholder="username"
                    required
                    className="h-8 text-sm"
                  />
                </Field>
                <Field label="Password">
                  <RevealInput
                    value={form.credPassword}
                    onChange={(v) => setField("credPassword", v)}
                    show={showPassword}
                    onToggle={() => setShowPassword((s) => !s)}
                    placeholder="password"
                    required
                  />
                </Field>
              </>
            )}

            {form.credType === "ssh_key" && (
              <>
                <Field label="Key Type">
                  <div className="flex items-center gap-2">
                    <Select
                      value={form.keyType}
                      onChange={(e) => setField("keyType", e.target.value)}
                      options={[
                        { value: "ed25519", label: "Ed25519 (recommended)" },
                        { value: "rsa", label: "RSA 4096" },
                        { value: "ecdsa", label: "ECDSA P-256" },
                      ]}
                    />
                    {(form.keyType === "ed25519" ||
                      form.keyType === "rsa") && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5"
                        onClick={handleGenerate}
                        disabled={generating}
                      >
                        <RefreshCw
                          className={`h-3 w-3 ${generating ? "animate-spin" : ""}`}
                        />
                        Generate
                      </Button>
                    )}
                  </div>
                </Field>

                <Field label="Private Key">
                  <div className="relative">
                    <Textarea
                      value={form.privateKey}
                      onChange={(e) => setField("privateKey", e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      rows={4}
                      className="font-mono text-xs pr-8"
                      required
                    />
                    {form.privateKey && (
                      <button
                        type="button"
                        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                        onClick={() => copyToClipboard(form.privateKey, "priv")}
                        title="Copy private key"
                      >
                        {copied === "priv" ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </Field>

                <Field
                  label="Public Key"
                  hint="Optional — stored for reference"
                >
                  <div className="relative">
                    <Textarea
                      value={form.publicKey}
                      onChange={(e) => setField("publicKey", e.target.value)}
                      placeholder="ssh-ed25519 AAAA…"
                      rows={2}
                      className="font-mono text-xs pr-8"
                    />
                    {form.publicKey && (
                      <button
                        type="button"
                        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                        onClick={() => copyToClipboard(form.publicKey, "pub")}
                        title="Copy public key"
                      >
                        {copied === "pub" ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </Field>

                <Field label="Passphrase" hint="Optional">
                  <RevealInput
                    value={form.passphrase}
                    onChange={(v) => setField("passphrase", v)}
                    show={showPassphrase}
                    onToggle={() => setShowPassphrase((s) => !s)}
                    placeholder="Leave blank for none"
                  />
                </Field>
              </>
            )}

            {form.credType === "certificate" && (
              <>
                <Field label="Certificate (PEM)">
                  <Textarea
                    value={form.certificate}
                    onChange={(e) => setField("certificate", e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    rows={4}
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field label="Private Key" hint="Optional">
                  <Textarea
                    value={form.certKey}
                    onChange={(e) => setField("certKey", e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    rows={3}
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Passphrase" hint="Optional">
                  <RevealInput
                    value={form.passphrase}
                    onChange={(v) => setField("passphrase", v)}
                    show={showPassphrase}
                    onToggle={() => setShowPassphrase((s) => !s)}
                    placeholder="Leave blank for none"
                  />
                </Field>
              </>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className="gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                {saving
                  ? "Saving…"
                  : selected === "new"
                    ? "Create"
                    : "Save Changes"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancel}
              >
                Cancel
              </Button>
              {selected !== "new" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  onClick={() => handleDelete(selected)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <Label className="text-xs font-medium">{label}</Label>
        {hint && (
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function RevealInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-8 text-sm pr-8"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        tabIndex={-1}
      >
        {show ? (
          <EyeOff className="h-3.5 w-3.5" />
        ) : (
          <Eye className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
