import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Radio,
  QrCode,
  KeyRound,
  RefreshCw,
  Trash2,
  Smartphone,
  ShieldCheck,
  ScanLine,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUiStore } from "@/stores/ui-store";
import { useVaultStore } from "@/stores/vault-store";
import { confirmDialog, promptDialog } from "@/stores/dialog-store";
import { isMobile } from "@/lib/platform";
import {
  lanApplyPending,
  lanDiscardPending,
  lanForget,
  lanNearby,
  lanPairCancel,
  lanPairConfirm,
  lanPairJoin,
  lanPairOffer,
  lanPullVault,
  lanSetLabel,
  lanStart,
  lanStatus,
  lanStop,
  lanSync,
  type LanEvent,
  type LanNearby,
  type LanOutcome,
  type LanPairOffer,
  type LanStatus,
} from "@/lib/tauri";

const OUTCOME_TEXT: Record<LanOutcome, string> = {
  up_to_date: "Already up to date",
  merged: "Vault merged",
  needs_password: "Needs the other vault's master password",
  different_vault: "That device holds a different vault",
  imported: "Vault received — unlock it with your master password",
  served: "Your vault was shared with that device",
};

function ago(ts: number | null) {
  if (!ts) return "never synced";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

interface Props {
  pullMode?: boolean;
  onImported?: () => void;
}

export function LanSyncPanel({ pullMode, onImported }: Props) {
  const addToast = useUiStore((s) => s.addToast);
  const refreshAll = useVaultStore((s) => s.refreshAll);
  const [st, setSt] = useState<LanStatus | null>(null);
  const [nearby, setNearby] = useState<LanNearby[]>([]);
  const [label, setLabel] = useState("");
  const [offer, setOffer] = useState<LanPairOffer | null>(null);
  const [offerLeft, setOfferLeft] = useState(0);
  const [joinInput, setJoinInput] = useState("");
  const [joinAddr, setJoinAddr] = useState("");
  const [showJoin, setShowJoin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sas, setSas] = useState<{
    peerId: string;
    label: string;
    sas: string;
  } | null>(null);
  const confirming = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const s = await lanStatus();
      setSt(s);
      setLabel((l) => l || s.label);
      if (s.running) setNearby(await lanNearby());
      else setNearby([]);
    } catch (e) {
      addToast({
        title: "Sync error",
        description: String(e),
        variant: "destructive",
      });
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
    const un = listen<LanEvent>("lan-event", (e) => {
      const ev = e.payload;
      if (ev.kind === "pair") {
        setOffer(null);
        setSas({
          peerId: ev.data.peer_id,
          label: ev.data.label,
          sas: ev.data.sas,
        });
      } else if (ev.kind === "synced") {
        addToast({ title: OUTCOME_TEXT[ev.data.outcome] });
        if (ev.data.outcome === "needs_password") void resolvePending();
      }
      refresh();
    });
    const t = setInterval(refresh, 4000);
    return () => {
      un.then((f) => f());
      clearInterval(t);
      lanPairCancel().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!offer) return;
    setOfferLeft(offer.expires_in);
    const t = setInterval(() => {
      setOfferLeft((n) => {
        if (n <= 1) {
          setOffer(null);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [offer]);

  const fail = (title: string, e: unknown) =>
    addToast({ title, description: String(e), variant: "destructive" });

  async function resolvePending() {
    const pw = await promptDialog({
      title: "Merge needs a password",
      message:
        "The other device's vault is sealed with a different master password. Enter that password to merge it into this vault.",
      secret: true,
    });
    if (!pw) {
      await lanDiscardPending().catch(() => {});
      return;
    }
    try {
      const out = await lanApplyPending(pw);
      await refreshAll();
      addToast({ title: OUTCOME_TEXT[out] });
    } catch (e) {
      await lanDiscardPending().catch(() => {});
      fail("Could not merge", e);
    }
    refresh();
  }

  const toggle = async () => {
    setBusy("toggle");
    try {
      if (st?.running) {
        await lanStop();
        setOffer(null);
      } else {
        await lanStart(label.trim() || undefined);
      }
      await refresh();
    } catch (e) {
      fail("Could not change visibility", e);
    } finally {
      setBusy(null);
    }
  };

  const makeOffer = async (kind: "qr" | "code") => {
    try {
      setOffer(await lanPairOffer(kind));
      setShowJoin(false);
    } catch (e) {
      fail("Could not open pairing", e);
    }
  };

  const join = async () => {
    setBusy("join");
    try {
      const r = await lanPairJoin(
        joinInput.trim(),
        joinAddr.trim() || undefined,
      );
      setShowJoin(false);
      setJoinInput("");
      setSas({ peerId: r.peer_id, label: r.label, sas: r.sas });
      await refresh();
    } catch (e) {
      fail("Pairing failed", e);
    } finally {
      setBusy(null);
    }
  };

  const scan = async () => {
    try {
      const m = await import("@tauri-apps/plugin-barcode-scanner");
      let perm = await m.checkPermissions();
      if (perm !== "granted") perm = await m.requestPermissions();
      if (perm !== "granted") {
        addToast({ title: "Camera permission is needed to scan" });
        return;
      }
      const res = await m.scan({ windowed: false, formats: [m.Format.QRCode] });
      setJoinInput(res.content);
      setShowJoin(true);
    } catch (e) {
      fail("Could not scan", e);
    }
  };

  const answerSas = async (accept: boolean) => {
    if (!sas || confirming.current) return;
    confirming.current = true;
    try {
      await lanPairConfirm(sas.peerId, accept);
      addToast({
        title: accept ? `Paired with ${sas.label}` : "Pairing cancelled",
      });
      setSas(null);
      await refresh();
    } catch (e) {
      fail("Could not finish pairing", e);
    } finally {
      confirming.current = false;
    }
  };

  async function runSync(
    peerId: string,
    addr: string | undefined,
    name: string,
  ) {
    let out = await lanSync(peerId, addr);
    if (out === "different_vault") {
      const ok = await confirmDialog({
        title: "Separate vaults",
        message: `This device and ${name} each have their own vault, so there is nothing to sync yet.\n\nMerge ${name}'s vault into this one? All hosts, keys and snippets from both are kept; nothing is removed on ${name}. Afterwards the two vaults stay in sync. (If it is sealed with a different master password you will be asked for it.)`,
        confirmLabel: "Merge vaults",
      });
      if (ok) out = await lanSync(peerId, addr, true);
    }
    return out;
  }

  const syncWith = async (peerId: string, name: string) => {
    setBusy(peerId);
    try {
      const addr = nearby.find((n) => n.peer_id === peerId)?.addrs[0];
      let out: LanOutcome;
      if (pullMode) {
        out = await lanPullVault(peerId, addr);
        if (out === "imported") onImported?.();
      } else {
        out = await runSync(peerId, addr, name);
        if (out === "merged") await refreshAll();
        if (out === "needs_password") await resolvePending();
      }
      addToast({ title: `${name}: ${OUTCOME_TEXT[out]}` });
    } catch (e) {
      fail("Sync failed", e);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const syncManual = async (peerId: string, name: string) => {
    const addr = await promptDialog({
      title: "Connect by address",
      message: `IP address and port shown on ${name} (for example 192.168.1.20:51234). Use this if automatic discovery is blocked by your router.`,
    });
    if (!addr) return;
    setBusy(peerId);
    try {
      const out = pullMode
        ? await lanPullVault(peerId, addr)
        : await runSync(peerId, addr, name);
      if (out === "merged") await refreshAll();
      if (out === "imported") onImported?.();
      if (out === "needs_password") await resolvePending();
      addToast({ title: `${name}: ${OUTCOME_TEXT[out]}` });
    } catch (e) {
      fail("Sync failed", e);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const forget = async (id: string, name: string) => {
    if (
      !(await confirmDialog({
        title: `Forget ${name}?`,
        message:
          "This device will stop syncing with it. Pair again to re-enable. To fully revoke access, also change the master password.",
        confirmLabel: "Forget",
        danger: true,
      }))
    )
      return;
    await lanForget(id).catch((e) => fail("Could not forget device", e));
    refresh();
  };

  const confirmed = st?.peers.filter((p) => p.confirmed) ?? [];
  const pairingNearby = nearby.filter((n) => n.pairing);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h2 className="text-base font-semibold">
            {pullMode ? "Get your vault from another device" : "Sync nearby"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Devices on the same network find each other with mDNS and exchange
            your already-encrypted vault directly. No server, no account, and
            nothing is announced until you switch visibility on.
          </p>
        </div>

        <section className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Radio
                className={`h-4 w-4 ${st?.running ? "text-green-500" : "text-muted-foreground"}`}
              />
              <div>
                <div className="text-sm font-medium">
                  {st?.running ? "Visible on this network" : "Hidden"}
                </div>
                <div className="text-xs text-muted-foreground">
                  {st?.running
                    ? "Only devices you paired can recognise this one."
                    : "Turn on only on a network you trust."}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant={st?.running ? "outline" : "default"}
              onClick={toggle}
              disabled={busy === "toggle"}
            >
              {st?.running ? "Stop" : "Start"}
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              value={label}
              maxLength={48}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() =>
                label.trim() && lanSetLabel(label.trim()).catch(() => {})
              }
              placeholder="Name shown to paired devices"
            />
          </div>
          {st?.running && st.discovery_error && (
            <p className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-500">
              Automatic discovery is not working: {st.discovery_error}. You can
              still pair and sync by entering the other device's address.
            </p>
          )}
          {st?.running && (
            <p className="text-xs text-muted-foreground">
              Network scan:{" "}
              {st.seen_total === 0
                ? "no other Watchtower seen yet (this can take a few seconds)"
                : `${st.seen_total} announcement(s) from other Watchtower devices received`}
              .
            </p>
          )}
          {st?.running && (
            <p className="text-xs text-muted-foreground">
              Listening on port {st.port}. Fingerprint{" "}
              <span className="font-mono">{st.fingerprint.slice(0, 8)}</span>
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Paired devices</h3>
          {confirmed.length === 0 && (
            <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              <Smartphone className="mx-auto mb-1 h-6 w-6 opacity-40" />
              No paired devices yet.
            </p>
          )}
          {confirmed.map((p) => {
            const here = nearby.some((n) => n.peer_id === p.id);
            return (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-muted-foreground">
                    <span className={here ? "text-green-500" : ""}>
                      {here ? "● nearby" : "○ not seen"}
                    </span>{" "}
                    · {ago(p.last_sync)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    disabled={busy === p.id || !st?.running}
                    onClick={() =>
                      here ? syncWith(p.id, p.label) : syncManual(p.id, p.label)
                    }
                  >
                    {pullMode ? (
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <RefreshCw
                        className={`mr-1.5 h-3.5 w-3.5 ${busy === p.id ? "animate-spin" : ""}`}
                      />
                    )}
                    {pullMode ? "Get vault" : here ? "Sync" : "Sync by address"}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-destructive"
                    onClick={() => forget(p.id, p.label)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Pair a new device</h3>
          {!st?.running ? (
            <p className="text-sm text-muted-foreground">
              Start nearby sync first.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => makeOffer("qr")}
                >
                  <QrCode className="mr-1.5 h-3.5 w-3.5" /> Show QR code
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => makeOffer("code")}
                >
                  <KeyRound className="mr-1.5 h-3.5 w-3.5" /> Show a code
                </Button>
                {isMobile && (
                  <Button size="sm" variant="outline" onClick={scan}>
                    <ScanLine className="mr-1.5 h-3.5 w-3.5" /> Scan QR
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowJoin((v) => !v);
                    setOffer(null);
                  }}
                >
                  Enter code
                </Button>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Devices on this network offering a pairing code
                </div>
                {pairingNearby.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    None found. On the other device open Sync nearby, press
                    Start, then “Show a code”. Both devices must be on the same
                    Wi-Fi/LAN (guest networks and some routers block device to
                    device traffic).
                  </p>
                )}
                {pairingNearby.map((n, i) => (
                  <div
                    key={n.addrs.join(",") + i}
                    className="flex items-center justify-between rounded-md border border-border p-2.5"
                  >
                    <span className="min-w-0 truncate text-sm">
                      Unpaired device
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {n.addrs[0]}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      onClick={() => {
                        setJoinAddr(n.addrs[0] ?? "");
                        setShowJoin(true);
                        setOffer(null);
                      }}
                    >
                      Pair
                    </Button>
                  </div>
                ))}
              </div>

              {offer && (
                <div className="space-y-2 rounded-md border border-border p-3 text-center">
                  {offer.qr_svg && (
                    <div
                      className="mx-auto w-56 rounded bg-white p-1 [&>svg]:h-auto [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: offer.qr_svg }}
                    />
                  )}
                  {offer.code && (
                    <div className="font-mono text-3xl tracking-widest">
                      {offer.code}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    On the other device choose{" "}
                    {offer.qr_svg ? "Scan QR" : "Enter code"}. Expires in{" "}
                    {offerLeft}s. Three wrong tries close the window.
                  </p>
                  {offer.qr_text && !isMobile && (
                    <button
                      className="text-xs text-muted-foreground underline"
                      onClick={() =>
                        navigator.clipboard.writeText(offer.qr_text!)
                      }
                    >
                      Copy pairing text
                    </button>
                  )}
                  {offer.addrs.length > 0 && (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {offer.addrs.join("  ")}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      lanPairCancel().catch(() => {});
                      setOffer(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {showJoin && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  <Input
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value)}
                    placeholder="123-456, or paste pairing text (wt1:…)"
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {!joinInput.startsWith("wt1:") && (
                    <Input
                      value={joinAddr}
                      onChange={(e) => setJoinAddr(e.target.value)}
                      placeholder={
                        pairingNearby.length
                          ? `Found ${pairingNearby.length} device(s) offering a code — leave empty`
                          : "Address of the other device, e.g. 192.168.1.20:51234"
                      }
                    />
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={join}
                      disabled={!joinInput.trim() || busy === "join"}
                    >
                      {busy === "join" ? "Pairing…" : "Pair"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowJoin(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {sas && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-popover p-5 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-green-500" />
              <div>
                <div className="text-sm font-semibold">
                  Pairing with {sas.label}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Both screens must show the same number. If they differ,
                  someone may be intercepting — choose “Doesn’t match”.
                </p>
              </div>
              <div className="font-mono text-4xl tracking-widest">
                {sas.sas}
              </div>
              <div className="flex justify-center gap-2">
                <Button variant="outline" onClick={() => answerSas(false)}>
                  Doesn’t match
                </Button>
                <Button onClick={() => answerSas(true)}>They match</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
