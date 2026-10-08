"use client";

import { useEffect, useState } from "react";
import { PENDING_LINK_CACHE, PICKUP_DIAG_KEY } from "@/components/pwa/service-worker-registration";

/**
 * TRAINING ONLY: what happened on this device for the last tapped phone
 * notification, to check deep links on an installed iPhone app without
 * developer tools. Shows times, page types and which steps ran — never ids,
 * links, tokens or any requisition content. Rendered only in training mode.
 */
type Snapshot = {
  standalone: boolean;
  controlled: boolean;
  worker: { build?: string; activatedAt?: number } | null;
  tap: Record<string, unknown> | null;
  pickup: { at?: number; result?: string; page?: string | null } | null;
};

async function readJson(key: string) {
  try {
    const response = await (await caches.open(PENDING_LINK_CACHE)).match(key);
    return response ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const when = (ms: unknown) => (typeof ms === "number" ? new Date(ms).toLocaleTimeString() : "—");

export function PushDiagnostics() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let pickup: Snapshot["pickup"] = null;
      try {
        pickup = JSON.parse(localStorage.getItem(PICKUP_DIAG_KEY) ?? "null");
      } catch {
        pickup = null;
      }
      const next: Snapshot = {
        standalone: window.matchMedia?.("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
        controlled: Boolean(navigator.serviceWorker?.controller),
        worker: typeof caches === "undefined" ? null : await readJson("/__tkt/diag-worker"),
        tap: typeof caches === "undefined" ? null : await readJson("/__tkt/diag-last-tap"),
        pickup,
      };
      if (!cancelled) setSnap(next);
    })();
    return () => { cancelled = true; };
  }, []);
  if (!snap) return null;
  const t = snap.tap;
  const rows: [string, string][] = [
    ["Installed app (standalone)", snap.standalone ? "yes" : "no"],
    ["Page controlled by a worker", snap.controlled ? "yes" : "no"],
    ["Active worker build", snap.worker?.build ? `${snap.worker.build} (activated ${when(snap.worker.activatedAt)})` : "not recorded (old worker)"],
    ["Last tap", t ? `${when(t.at)} · ${String(t.page)} · build ${String(t.build)}` : "none recorded"],
    ["Tap steps", t ? `windows ${String(t.windows)} · exact ${String(t.exact)} · navigate ${String(t.navigate)} · message ${String(t.messaged)} · openWindow ${String(t.opened)}${t.error ? " · error" : ""}${t.hadData === false ? " · no data" : ""}` : "—"],
    ["App pickup", snap.pickup ? `${when(snap.pickup.at)} · ${snap.pickup.result ?? "?"}${snap.pickup.page ? ` · ${snap.pickup.page}` : ""}` : "none recorded"],
  ];
  return (
    <section aria-labelledby="push-diag-title" className="mb-5 rounded-[var(--radius-card)] border border-dashed border-navy/25 bg-white p-4 text-sm">
      <h2 id="push-diag-title" className="font-bold">Training diagnostics · phone notification taps</h2>
      <p className="mt-1 text-[13px] text-navy/60">Shown only in the training environment. No links, ids or request details are recorded.</p>
      <dl className="mt-3 grid gap-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[11rem_1fr] gap-2"><dt className="text-navy/60">{k}</dt><dd className="font-medium">{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}
