import React, { useState, useEffect } from "react";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "@/stores/vault-store";
import {
  vaultExists,
  vaultDefaultPath,
  biometricAvailable,
  biometricHas,
  biometricStore,
  biometricRetrieve,
} from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Shield,
  Lock,
  Plus,
  FolderOpen,
  Eye,
  EyeOff,
  ArrowLeft,
  ChevronRight,
  Fingerprint,
} from "lucide-react";

type Mode = "choose" | "unlock" | "create" | "open-file";

const RECENT_VAULT_KEY = "watchtower:recent_vault_path";
const RECENT_VAULTS_KEY = "watchtower:recent_vaults";

function getRecentPaths(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_VAULTS_KEY) || "[]");
    if (Array.isArray(arr) && arr.length) return arr.slice(0, 6);
    const single = localStorage.getItem(RECENT_VAULT_KEY);
    return single ? [single] : [];
  } catch {
    return [];
  }
}

function setRecentPath(path: string) {
  try {
    localStorage.setItem(RECENT_VAULT_KEY, path);
    const list = [path, ...getRecentPaths().filter((p) => p !== path)].slice(
      0,
      6,
    );
    localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function VaultPage() {
  const {
    vaultExists: hasDefaultVault,
    createVault,
    openVault,
    loading,
    error,
    clearError,
  } = useVaultStore();

  const [mode, setMode] = useState<Mode>(hasDefaultVault ? "unlock" : "choose");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pathVaultExists, setPathVaultExists] = useState<boolean | null>(null);
  const [createPath, setCreatePath] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [bioPath, setBioPath] = useState<string | null>(null);
  const [bioHasEntry, setBioHasEntry] = useState(false);
  const recentPaths = getRecentPaths();
  const recentPath = recentPaths[0] ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let p: string | null = null;
      if (mode === "unlock") {
        p = await vaultDefaultPath().catch(() => null);
      } else if (mode === "open-file") {
        p = selectedPath;
      }
      if (cancelled) return;
      setBioPath(p);
      if (p && (await biometricAvailable(p).catch(() => false))) {
        const has = await biometricHas(p).catch(() => false);
        if (!cancelled) setBioHasEntry(has);
      } else if (!cancelled) {
        setBioHasEntry(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, selectedPath]);

  const handleBiometricUnlock = async () => {
    if (!bioPath) return;
    clearError();
    try {
      const pw = await biometricRetrieve(bioPath);
      if (!pw) return;
      await openVault(pw, mode === "unlock" ? undefined : bioPath);
    } catch {
      /* store surfaces the error */
    }
  };

  useEffect(() => {
    setMode(hasDefaultVault ? "unlock" : "choose");
  }, [hasDefaultVault]);

  useEffect(() => {
    if (!selectedPath) {
      setPathVaultExists(null);
      return;
    }
    let cancelled = false;
    vaultExists(selectedPath).then((exists) => {
      if (!cancelled) setPathVaultExists(exists);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const reset = (next: Mode) => {
    clearError();
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
    setCreatePath(null);
    setMode(next);
  };

  const handlePickSaveLocation = async () => {
    const result = await saveFileDialog({
      title: "Create Watchtower Vault",
      defaultPath: "vault.nyt",
      filters: [{ name: "Watchtower Vault", extensions: ["nyt"] }],
    });
    if (result) {
      setCreatePath(result);
      clearError();
    }
  };

  const handlePickFile = async () => {
    const result = await openFileDialog({
      title: "Open Watchtower Vault",
      filters: [{ name: "Watchtower Vault", extensions: ["nyt"] }],
      multiple: false,
      directory: false,
    });
    if (result) {
      const path = typeof result === "string" ? result : result;
      setSelectedPath(path as string);
      clearError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      if (mode === "create") {
        await createVault(password, createPath ?? undefined);
        if (createPath) setRecentPath(createPath);
        if (remember && createPath)
          await biometricStore(createPath, password).catch(() => {});
      } else if (mode === "unlock") {
        await openVault(password);
        if (remember && bioPath)
          await biometricStore(bioPath, password).catch(() => {});
      } else if (mode === "open-file" && selectedPath) {
        await openVault(password, selectedPath);
        setRecentPath(selectedPath);
        if (remember)
          await biometricStore(selectedPath, password).catch(() => {});
      }
    } catch {
      /* store surfaces the error */
    }
    setPassword("");
    setConfirmPassword("");
  };

  const passwordMismatch =
    mode === "create" &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;
  const tooShort =
    mode === "create" && password.length > 0 && password.length < 4;

  const canSubmit =
    !loading &&
    password.length > 0 &&
    (mode !== "create" ||
      (!passwordMismatch &&
        !tooShort &&
        confirmPassword.length > 0 &&
        !!createPath)) &&
    (mode !== "open-file" || !!selectedPath);

  if (mode === "choose") {
    return (
      <VaultLayout>
        <p className="text-sm text-muted-foreground text-center mb-8">
          Create a new encrypted vault or open an existing one.
        </p>

        <div className="flex flex-col gap-3 w-full max-w-xs mx-auto">
          <ChoiceButton
            icon={<Plus className="h-4 w-4" />}
            label="Create new vault"
            description="Set up a new encrypted vault"
            onClick={() => reset("create")}
          />

          <ChoiceButton
            icon={<FolderOpen className="h-4 w-4" />}
            label="Open vault file"
            description="Browse for an existing .nyt file"
            onClick={() => {
              reset("open-file");
            }}
          />

          {recentPaths.length > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <p className="text-xs text-muted-foreground px-1">Recent</p>
              {recentPaths.map((rp) => (
                <ChoiceButton
                  key={rp}
                  icon={<Lock className="h-4 w-4" />}
                  label={rp.split(/[/\\]/).pop() ?? rp}
                  description={rp}
                  onClick={() => {
                    reset("open-file");
                    setTimeout(() => setSelectedPath(rp), 0);
                  }}
                />
              ))}
            </>
          )}
        </div>
      </VaultLayout>
    );
  }

  if (mode === "open-file") {
    const fileName = selectedPath ? selectedPath.split(/[/\\]/).pop() : null;

    return (
      <VaultLayout
        back={hasDefaultVault ? () => reset("unlock") : () => reset("choose")}
        title="Open Vault"
        description="Choose a vault file and enter its master password."
      >
        <form
          onSubmit={handleSubmit}
          className="space-y-5 w-full max-w-xs mx-auto"
        >
          <div className="space-y-2">
            <Label>Vault file</Label>
            <button
              type="button"
              onClick={handlePickFile}
              className="w-full flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm hover:bg-muted/70 transition-colors"
            >
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
              {selectedPath ? (
                <span className="truncate text-left">
                  {fileName}
                  <span className="block text-xs text-muted-foreground truncate">
                    {selectedPath}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Browse for .nyt file…
                </span>
              )}
            </button>
            {selectedPath && pathVaultExists === false && (
              <p className="text-xs text-destructive">
                No valid vault found at this path.
              </p>
            )}
          </div>

          <PasswordField
            id="of-password"
            label="Master Password"
            value={password}
            show={showPassword}
            onChange={setPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoFocus
          />

          {error && <ErrorBox message={error} />}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? (
              <span className="animate-pulse">Opening…</span>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Open Vault
              </>
            )}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Need a new vault?{" "}
            <button
              type="button"
              className="underline hover:text-foreground"
              onClick={() => reset("create")}
            >
              Create one
            </button>
          </p>
        </form>
      </VaultLayout>
    );
  }

  if (mode === "unlock") {
    return (
      <VaultLayout
        title="Unlock Vault"
        description="Enter your master password to access your servers."
      >
        <form
          onSubmit={handleSubmit}
          className="space-y-5 w-full max-w-xs mx-auto"
        >
          {bioHasEntry && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleBiometricUnlock}
              disabled={loading}
            >
              <Fingerprint className="mr-2 h-4 w-4" />
              Unlock with system keychain
            </Button>
          )}

          <PasswordField
            id="ul-password"
            label="Master Password"
            value={password}
            show={showPassword}
            onChange={setPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
            autoFocus
          />

          {!bioHasEntry && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="rounded border-border"
              />
              Remember on this device (system keychain)
            </label>
          )}

          {error && <ErrorBox message={error} />}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {loading ? (
              <span className="animate-pulse">Unlocking…</span>
            ) : (
              <>
                <Lock className="mr-2 h-4 w-4" />
                Unlock
              </>
            )}
          </Button>

          <div className="flex flex-col gap-1.5 items-center">
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => reset("open-file")}
            >
              Open a different vault file
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => reset("create")}
            >
              Create a new vault
            </button>
          </div>
        </form>
      </VaultLayout>
    );
  }

  return (
    <VaultLayout
      back={hasDefaultVault ? () => reset("unlock") : () => reset("choose")}
      title="Create Vault"
      description="Choose a location and set a master password to protect your servers and credentials."
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-5 w-full max-w-xs mx-auto"
      >
        <div className="space-y-2">
          <Label>Vault location</Label>
          <button
            type="button"
            onClick={handlePickSaveLocation}
            className="w-full flex items-center gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm hover:bg-muted/70 transition-colors"
          >
            <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
            {createPath ? (
              <span className="truncate text-left">
                {createPath.split(/[/\\]/).pop()}
                <span className="block text-xs text-muted-foreground truncate">
                  {createPath}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Choose save location…
              </span>
            )}
          </button>
        </div>

        <PasswordField
          id="cr-password"
          label="Master Password"
          value={password}
          show={showPassword}
          onChange={setPassword}
          onToggleShow={() => setShowPassword((v) => !v)}
          autoFocus
        >
          {tooShort && (
            <p className="text-xs text-destructive">
              Password must be at least 4 characters
            </p>
          )}
        </PasswordField>

        <PasswordField
          id="cr-confirm"
          label="Confirm Password"
          value={confirmPassword}
          show={showConfirm}
          onChange={setConfirmPassword}
          onToggleShow={() => setShowConfirm((v) => !v)}
        >
          {passwordMismatch && (
            <p className="text-xs text-destructive">Passwords do not match</p>
          )}
        </PasswordField>

        {error && <ErrorBox message={error} />}

        <Button type="submit" className="w-full" disabled={!canSubmit}>
          {loading ? (
            <span className="animate-pulse">Creating…</span>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Create Vault
            </>
          )}
        </Button>
      </form>
    </VaultLayout>
  );
}

function VaultLayout({
  children,
  title,
  description,
  back,
}: {
  children: React.ReactNode;
  title?: string;
  description?: string;
  back?: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6 py-10 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <img
              src="/watchtower-logo-white.svg"
              alt="Watchtower Logo"
              className="h-7 w-7"
            />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Watchtower</h1>
            {title && <p className="text-base font-medium mt-3">{title}</p>}
            {description && (
              <p className="text-sm text-muted-foreground mt-1">
                {description}
              </p>
            )}
          </div>
        </div>

        {children}

        {back && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={back}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChoiceButton({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full rounded-lg border border-border bg-card px-4 py-3 text-left hover:bg-muted/50 transition-colors group"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground transition-colors">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{label}</span>
        <span className="block text-xs text-muted-foreground truncate">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

function PasswordField({
  id,
  label,
  value,
  show,
  onChange,
  onToggleShow,
  autoFocus,
  children,
}: {
  id: string;
  label: string;
  value: string;
  show: boolean;
  onChange: (v: string) => void;
  onToggleShow: () => void;
  autoFocus?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          placeholder="Enter password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          className="pr-10"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggleShow}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
      {message}
    </p>
  );
}
