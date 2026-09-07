import { useEffect, useRef } from "react";
import { useVaultStore } from "@/stores/vault-store";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "wheel",
  "touchstart",
] as const;

export function useAutoLock() {
  const isUnlocked = useVaultStore((s) => s.isUnlocked);
  const minutes = useVaultStore((s) => s.settings?.auto_lock_minutes ?? 0);
  const lockVault = useVaultStore((s) => s.lockVault);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!isUnlocked || !minutes || minutes <= 0) return;

    const ms = minutes * 60_000;
    const reset = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        lockVault();
      }, ms);
    };

    reset();
    for (const ev of ACTIVITY_EVENTS)
      window.addEventListener(ev, reset, { passive: true });
    document.addEventListener("visibilitychange", reset);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
      document.removeEventListener("visibilitychange", reset);
    };
  }, [isUnlocked, minutes, lockVault]);
}
