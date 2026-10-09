import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";
import { isMobile } from "@/lib/platform";
import { mobileKeepalive } from "@/lib/tauri";

const KEY = "watchtower:keepalive";

export function getKeepAlive(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setKeepAlive(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  syncKeepAlive();
}

function syncKeepAlive() {
  const n = useSessionStore
    .getState()
    .sessions.filter((s) => s.status === "connected" && !s.paneOf).length;
  mobileKeepalive(getKeepAlive() && n > 0, n).catch(() => {});
}

export function useKeepAlive() {
  useEffect(() => {
    if (!isMobile) return;
    let last = -1;
    const un = useSessionStore.subscribe((s) => {
      const n = s.sessions.filter(
        (x) => x.status === "connected" && !x.paneOf,
      ).length;
      if (n !== last) {
        last = n;
        syncKeepAlive();
      }
    });
    return () => {
      un();
      mobileKeepalive(false, 0).catch(() => {});
    };
  }, []);
}
