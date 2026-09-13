import React, { useState, useEffect, useCallback } from "react";
import {
  open as openFileDialog,
  save as saveFileDialog,
} from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "@/stores/vault-store";
import {
  vaultExists,
  vaultDefaultPath,
  vaultCurrentPath,
  biometricAvailable,
  biometricStore,
  biometricRetrieve,
} from "@/lib/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Lock,
  Plus,
  FolderOpen,
  Eye,
  EyeOff,
  ArrowLeft,
  ChevronRight,
  Fingerprint,
} from "lucide-react";

type Mode = "main" | "create" | "switch";

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

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

async function resolveTargetVault(): Promise<string | null> {
  const current = await vaultCurrentPath().catch(() => null);
  if (current) return current;

  const hasDefault = await vaultExists().catch(() => false);
  if (hasDefault) {
    const defaultPath = await vaultDefaultPath().catch(() => null);
    if (defaultPath) return defaultPath;
  }

  for (const rp of getRecentPaths()) {
    if (await vaultExists(rp).catch(() => false)) return rp;
  }
  return null;
}

export function VaultPage() {
  const { createVault, openVault, loading, error, clearError, hasUnlockedOnce } =
    useVaultStore();

  const [mode, setMode] = useState<Mode>("main");
  const [resolving, setResolving] = useState(true);
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [targetInvalid, setTargetInvalid] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [createPath, setCreatePath] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioMessage, setBioMessage] = useState<string | null>(null);

  const recentPaths = getRecentPaths().filter((p) => p !== targetPath);

  useEffect(() => {
    let cancelled = false;
    setResolving(true);
    resolveTargetVault().then((p) => {
      if (cancelled) return;
      setTargetPath(p);
      if (!p) setMode("switch");
      setResolving(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBioMessage(null);
    setTargetInvalid(false);
    if (!targetPath) {
      setBioAvailable(false);
      return;
    }
    (async () => {
      const exists = await vaultExists(targetPath).catch(() => false);
      if (cancelled) return;
      if (!exists) {
        setTargetInvalid(true);
        setBioAvailable(false);
        return;
      }
      const available = await biometricAvailable(targetPath).catch(
        () => false,
      );
      if (cancelled) return;
      setBioAvailable(available);
      if (available && !hasUnlockedOnce) {
        try {
          const pw = await biometricRetrieve(targetPath);
          if (!cancelled && pw) await openVault(pw, targetPath);
        } catch {
          /* fall through to manual unlock */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetPath]);

  const handleBiometricUnlock = async () => {
    if (!targetPath) return;
    clearError();
    setBioMessage(null);
    try {
      const pw = await biometricRetrieve(targetPath);
      if (!pw) {
        setBioMessage(
          "No password saved in the system keychain for this vault yet — enter it below and check “Remember on this device” to save it.",
        );
        return;
      }
      await openVault(pw, targetPath);
    } catch (e) {
      setBioMessage(String(e));
    }
  };

  const reset = useCallback((next: Mode) => {
    clearError();
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
    setCreatePath(null);
    setRemember(false);
    setMode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePickSaveLocation = async () => {
    const result = await saveFileDialog({
      title: "Create Watchtower Vault",
      defaultPath: "vault.watchtower",
      filters: [{ name: "Watchtower Vault", extensions: ["watchtower"] }],
    });
    if (result) {
      setCreatePath(result);
      clearError();
    }
  };

  const handleBrowseForVault = async () => {
    const result = await openFileDialog({
      title: "Open Watchtower Vault",
      filters: [{ name: "Watchtower Vault", extensions: ["watchtower", "nyt"] }],
      multiple: false,
      directory: false,
    });
    if (result) {
      clearError();
      setPassword("");
      setTargetPath(result as string);
      setMode("main");
    }
  };

  const handleSelectRecent = (rp: string) => {
    clearError();
    setPassword("");
    setTargetPath(rp);
    setMode("main");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      if (mode === "create") {
        await createVault(password, createPath ?? undefined);
        if (createPath) {
          setRecentPath(createPath);
          if (remember) await biometricStore(createPath, password).catch(() => {});
        }
      } else if (targetPath) {
        await openVault(password, targetPath);
        setRecentPath(targetPath);
        if (remember)
          await biometricStore(targetPath, password).catch(() => {});
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
    (mode !== "create"
      ? !!targetPath && !targetInvalid
      : !passwordMismatch && !tooShort && confirmPassword.length > 0 && !!createPath);

  if (mode === "create") {
    return (
      <VaultLayout
        back={() => reset("switch")}
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
                  {fileNameOf(createPath)}
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

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            Remember on this device (system keychain)
          </label>

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

  if (mode === "switch") {
    return (
      <VaultLayout
        back={targetPath ? () => reset("main") : undefined}
        title="Select a vault"
        description="Create a new encrypted vault or open an existing one."
      >
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
            description="Browse for an existing .watchtower file"
            onClick={handleBrowseForVault}
          />

          {recentPaths.length > 0 && (
            <>
              <div className="border-t border-border my-1" />
              <p className="text-xs text-muted-foreground px-1">Recent</p>
              {recentPaths.map((rp) => (
                <ChoiceButton
                  key={rp}
                  icon={<Lock className="h-4 w-4" />}
                  label={fileNameOf(rp)}
                  description={rp}
                  onClick={() => handleSelectRecent(rp)}
                />
              ))}
            </>
          )}
        </div>
      </VaultLayout>
    );
  }

  return (
    <VaultLayout title="Unlock Vault" description="Enter your master password to access your servers.">
      {resolving ? (
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-5 w-full max-w-xs mx-auto"
        >
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm">
            <div className="font-medium truncate">
              {targetPath ? fileNameOf(targetPath) : "No vault selected"}
            </div>
            {targetPath && (
              <div className="text-xs text-muted-foreground truncate">
                {targetPath}
              </div>
            )}
          </div>

          {targetInvalid && (
            <p className="text-xs text-destructive">
              No valid vault found at this path anymore.
            </p>
          )}

          {bioAvailable && (
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

          {bioMessage && (
            <p className="text-xs text-muted-foreground">{bioMessage}</p>
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

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            Remember on this device (system keychain)
          </label>

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

          <div className="flex justify-center">
            <button
              type="button"
              className="text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => reset("switch")}
            >
              Use a different vault
            </button>
          </div>
        </form>
      )}
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
