import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

const KEY = "wt-analytics";

export interface AnalyticsConsent {
  /** false until the user has answered the first-run popup */
  decided: boolean;
  usage: boolean;
  errors: boolean;
}

function read(): AnalyticsConsent {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      return {
        decided: true,
        usage: v.usage === true,
        errors: v.errors === true,
      };
    }
  } catch {
    /* ignore */
  }
  return { decided: false, usage: false, errors: false };
}

function push(c: AnalyticsConsent) {
  invoke("analytics_configure", { usage: c.usage, errors: c.errors }).catch(
    () => {},
  );
}

interface AnalyticsStore extends AnalyticsConsent {
  setConsent: (usage: boolean, errors: boolean) => void;
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  ...read(),
  setConsent: (usage, errors) => {
    const c = { decided: true, usage, errors };
    try {
      localStorage.setItem(KEY, JSON.stringify({ usage, errors }));
    } catch {
      /* ignore */
    }
    push(c);
    set(c);
    if (usage) trackEvent("consent_enabled");
  },
}));

/** Mirror stored consent to the backend and install error hooks. Call once. */
export function initAnalytics() {
  push(read());
  trackEvent("app_started");
  window.addEventListener("error", (e) =>
    trackError("window_error", e.message, e.filename),
  );
  window.addEventListener("unhandledrejection", (e) =>
    trackError("unhandled_rejection", String(e.reason?.message ?? e.reason)),
  );
}

/** Anonymous usage count. Props must be coarse values (protocol, view...). */
export function trackEvent(name: string, props?: Record<string, string>) {
  if (!useAnalyticsStore.getState().usage) return;
  invoke("analytics_track", { kind: "usage", name, props }).catch(() => {});
}

/** Scrub anything that could identify a host, user or file before sending. */
function scrub(s: string): string {
  return s
    .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\b/gi, "<host>")
    .replace(/(\/Users|\/home|[A-Z]:\\Users)[\\/][^\s\\/]+/gi, "<home>")
    .slice(0, 300);
}

export function trackError(name: string, message: string, source?: string) {
  if (!useAnalyticsStore.getState().errors) return;
  invoke("analytics_track", {
    kind: "error",
    name,
    props: {
      message: scrub(message || ""),
      source: source ? scrub(source.split("/").pop() ?? "") : "",
    },
  }).catch(() => {});
}
