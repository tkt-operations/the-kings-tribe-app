"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Smartphone, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { LoadingButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { publicEnv } from "@/lib/env";
import { deviceLabel, pushSupport, sameServerKey, urlBase64ToUint8Array } from "@/lib/push/client";
import { getPushStatus, removePushDevice, removePushSubscription, savePushSubscription, setPushLevel, type PushStatus } from "@/app/(app)/notifications/push-actions";
import { listTestPushTargets, sendTestPush, type TestPushTarget } from "@/app/(app)/notifications/push-test-actions";

/**
 * "Phone notifications" for the signed-in user. Permission is requested ONLY
 * when the user presses "Enable phone notifications", after the explanation.
 * Whatever happens here, the in-app inbox (and email) keep working.
 */
export type PushPhase = "checking" | "not_configured" | "unsupported" | "ios_install" | "denied" | "off" | "granted_off" | "on";

export const PUSH_COPY = {
  intro: "Get an alert on this device when something needs you — for example a new requisition to review. Alerts show only a short message; details open in the app after you sign in.",
  notConfigured: "Phone notifications aren't available yet.",
  unsupported: "This browser doesn't support phone notifications. You'll still see everything in the bell and on this page.",
  iosInstall: "On iPhone or iPad, first add The Kings Tribe to your Home Screen (Share → Add to Home Screen), then open it from there and come back to this page.",
  denied: "Notifications are blocked for this site. To use them, allow notifications for this site in your browser or device settings. In-app notifications keep working.",
  grantedOff: "Phone notifications are not on for this device.",
  on: "On for this device.",
  signOut: "Signing out does not turn alerts off on a device — remove it here.",
} as const;

async function readyRegistration(timeoutMs = 4000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}

export function PushSettings({ selfTest = false }: { selfTest?: boolean } = {}) {
  const toast = useToast();
  const publicKey = publicEnv().vapidPublicKey;
  const [phase, setPhase] = useState<PushPhase>("checking");
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const sync = useCallback(async () => {
    if (!publicKey) return setPhase("not_configured");
    const support = pushSupport();
    if (support === "ios_needs_install") return setPhase("ios_install");
    if (support === "unsupported") return setPhase("unsupported");
    try {
      const registration = await readyRegistration();
      if (!registration) return setPhase("unsupported");
      const subscription = await registration.pushManager.getSubscription();
      const result = await getPushStatus(subscription?.endpoint ?? null);
      if (result.ok) setStatus(result.data);
      if (result.ok && !result.data.configured) return setPhase("not_configured");
      const permission = Notification.permission;
      if (permission === "denied") return setPhase("denied");
      if (subscription && result.ok && result.data.thisDevice && sameServerKey(subscription, publicKey)) return setPhase("on");
      setPhase(permission === "granted" ? "granted_off" : "off");
    } catch {
      setPhase("unsupported");
    }
  }, [publicKey]);

  useEffect(() => {
    const id = setTimeout(() => void sync(), 0);
    return () => clearTimeout(id);
  }, [sync]);

  /** Direct user gesture: request permission (if needed), subscribe, save to this account. */
  async function enable() {
    setBusy(true);
    try {
      let permission = Notification.permission;
      if (permission !== "granted") permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPhase(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await readyRegistration();
      if (!registration) throw new Error("no service worker");
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameServerKey(subscription, publicKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const json = subscription.toJSON();
      const result = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel(navigator.userAgent) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.data.transferred ? "Phone notifications are on for this device (moved to your account)." : result.message ?? PUSH_COPY.on);
      await sync();
    } catch {
      toast.error("Phone notifications could not be turned on on this device.");
      await sync();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await readyRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await removePushSubscription(subscription.endpoint);
        if (!result.ok) toast.error(result.error);
        await subscription.unsubscribe().catch(() => false);
        if (result.ok) toast.success(result.message ?? "Phone notifications are off for this device.");
      }
      await sync();
    } finally {
      setBusy(false);
    }
  }

  async function removeDevice(id: string, isThisDevice: boolean) {
    if (isThisDevice) return disable();
    setBusy(true);
    const result = await removePushDevice(id);
    setBusy(false);
    if (result.ok) toast.success(result.message ?? "Device removed.");
    else toast.error(result.error);
    await sync();
  }

  async function changeLevel(level: "important" | "actionable") {
    const result = await setPushLevel(level);
    if (result.ok) {
      setStatus((s) => (s ? { ...s, pushLevel: result.data.pushLevel } : s));
      toast.success(result.message ?? "Saved.");
    } else {
      toast.error(result.error);
    }
  }

  const devices = status?.devices ?? [];
  const showSelfTest = selfTest && Boolean(status?.configured) && devices.length > 0;
  return (
    <section aria-labelledby="push-settings-title" className="mb-5 rounded-[var(--radius-card)] bg-white p-4 ring-1 ring-navy/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/25 text-navy" aria-hidden>
            <BellRing className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="push-settings-title" className="font-bold">Phone notifications</h2>
            <p className="mt-0.5 text-[13px] text-navy/65">{PUSH_COPY.intro}</p>
            <p id="push-settings-status" className="mt-2 text-sm font-medium text-navy" role="status" aria-live="polite">
              {phase === "checking" ? "Checking this device…" : null}
              {phase === "not_configured" ? PUSH_COPY.notConfigured : null}
              {phase === "unsupported" ? PUSH_COPY.unsupported : null}
              {phase === "ios_install" ? PUSH_COPY.iosInstall : null}
              {phase === "denied" ? PUSH_COPY.denied : null}
              {phase === "granted_off" ? PUSH_COPY.grantedOff : null}
              {phase === "on" ? PUSH_COPY.on : null}
            </p>
          </div>
        </div>
        <div className="w-full sm:w-auto">
          {phase === "off" ? (
            <LoadingButton type="button" variant="primary" className="h-12 w-full sm:w-auto" pending={busy} pendingLabel="Turning on…" onClick={() => void enable()}>
              Enable phone notifications
            </LoadingButton>
          ) : phase === "granted_off" ? (
            <LoadingButton type="button" variant="primary" className="h-12 w-full sm:w-auto" pending={busy} pendingLabel="Turning on…" onClick={() => void enable()}>
              Turn on for this device
            </LoadingButton>
          ) : phase === "on" ? (
            <LoadingButton type="button" variant="secondary" className="h-12 w-full sm:w-auto" pending={busy} pendingLabel="Turning off…" onClick={() => void disable()}>
              Turn off for this device
            </LoadingButton>
          ) : null}
        </div>
      </div>

      {status && phase !== "not_configured" && (phase === "on" || devices.length > 0) ? (
        <div className="mt-4 grid gap-4 border-t border-navy/10 pt-4 lg:grid-cols-2">
          {/* min-w-0: a fieldset otherwise refuses to shrink below its content (overflow on phones). */}
          <fieldset className="min-w-0">
            <legend className="mb-2 text-sm font-medium">Send phone alerts for</legend>
            <div className="grid gap-2">
              {([
                ["actionable", "Important & actionable (recommended)", "New requisitions, approvals ready for the next step, receipts and assignments."],
                ["important", "Important only", "Essential requisitions and requisitions assigned to you."],
              ] as const).map(([value, label, hint]) => (
                <label key={value} className={cn("flex min-h-12 cursor-pointer gap-3 rounded-xl border p-3", status.pushLevel === value ? "border-navy ring-2 ring-gold" : "border-navy/15")}>
                  <input type="radio" name="push_level" value={value} checked={status.pushLevel === value} onChange={() => void changeLevel(value)} className="mt-1 size-4 shrink-0 accent-navy" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-[13px] text-navy/60">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-navy/60">Everything still appears in the bell and on this page.</p>
          </fieldset>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-medium">Your devices</p>
            {devices.length === 0 ? (
              <p className="text-[13px] text-navy/60">No devices yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-gray px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <Smartphone className="size-4 shrink-0 text-navy/60" aria-hidden />
                      <span className="truncate">{d.label ?? "Device"}{d.this_device ? " (this device)" : ""}</span>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeDevice(d.id, d.this_device)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-navy/60 hover:bg-white hover:text-navy disabled:opacity-40"
                      aria-label={`Remove ${d.label ?? "device"}${d.this_device ? " (this device)" : ""}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[13px] text-navy/60">{PUSH_COPY.signOut}</p>
          </div>
        </div>
      ) : null}

      {showSelfTest ? <PushSelfTest /> : null}
    </section>
  );
}

/**
 * TEMPORARY — administrator-only Web Push self-test (deep-link check). Sends one
 * fixed alert to the administrator's own phone(s), opening a requisition chosen
 * from their own recent list. Remove with app/(app)/notifications/push-test-actions.ts.
 */
function PushSelfTest() {
  const toast = useToast();
  const [targets, setTargets] = useState<TestPushTarget[] | null>(null);
  const [selected, setSelected] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listTestPushTargets().then((r) => {
      if (!cancelled) setTargets(r.ok ? r.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send() {
    if (!selected || sending) return;
    setSending(true);
    setResult(null);
    try {
      const r = await sendTestPush(selected);
      if (r.ok) {
        setResult(r.message ?? "Test notification sent.");
        toast.success(r.message ?? "Test notification sent.");
      } else {
        setResult(r.error);
        toast.error(r.error);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-dashed border-gold bg-gold/[0.08] p-3" data-testid="push-self-test">
      <p className="text-sm font-bold">Send test notification <span className="font-normal text-navy/60">(temporary, administrators only)</span></p>
      <p className="mt-0.5 text-[13px] text-navy/65">Sends one generic alert to your own phone. Tapping it should open the requisition you choose. Nothing else is created or emailed.</p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="push-self-test-requisition">Requisition to open</label>
        <select
          id="push-self-test-requisition"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={targets === null || sending}
          className="h-12 min-w-0 flex-1 rounded-xl border border-navy/15 bg-white px-3 text-sm"
        >
          <option value="">{targets === null ? "Loading requisitions…" : "Choose a requisition to open"}</option>
          {(targets ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.requisition_number}</option>
          ))}
        </select>
        <LoadingButton type="button" variant="secondary" className="h-12 w-full sm:w-auto" pending={sending} pendingLabel="Sending…" disabled={!selected} onClick={() => void send()}>
          Send test notification
        </LoadingButton>
      </div>
      {result ? <p className="mt-2 text-[13px] font-medium" role="status">{result}</p> : null}
    </div>
  );
}
