"use client";

/** TEMPORARY — administrator email delivery self-test card (see ./email-test-actions.ts). */

import { useCallback, useEffect, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LoadingButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/dates";
import type { SelfTestStatus } from "@/lib/email/self-test";
import { getTestEmailStatus, sendTestEmailToMyself } from "./email-test-actions";

export function EmailSelfTest({ timezone }: { timezone: string }) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<SelfTestStatus | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const result = await getTestEmailStatus();
    setRefreshing(false);
    if (result.ok) setStatus(result.data);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, [refresh]);

  async function send() {
    if (inFlight.current) return; // one invocation per press, even on a double tap
    inFlight.current = true;
    setSending(true);
    try {
      const result = await sendTestEmailToMyself();
      if (result.ok) toast.success(result.message ?? "Test email accepted for delivery.");
      else toast.error(result.error);
      await refresh();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <section aria-labelledby="email-self-test-title" className="mt-5 rounded-[var(--radius-card)] border border-dashed border-navy/25 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/25 text-navy" aria-hidden>
            <MailCheck className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="email-self-test-title" className="font-bold">Email delivery test <span className="font-normal text-navy/60">(temporary diagnostic)</span></h2>
            <p className="mt-0.5 text-[13px] text-navy/65">
              Sends one fixed test message to your own account email to check delivery tracking. It is not linked to any requisition. Administrators only; at most one every 10 minutes.
            </p>
          </div>
        </div>
        <LoadingButton type="button" variant="secondary" className="h-12 w-full sm:w-auto" pending={sending} pendingLabel="Sending…" disabled={sending} onClick={() => void send()}>
          Send test email to myself
        </LoadingButton>
      </div>
      <div className="mt-4 border-t border-navy/10 pt-3 text-[13px] text-navy/75" data-testid="email-self-test-status">
        {status ? (
          <>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>Latest test: {status.app} · {formatDateTime(status.sentAt, timezone)}</span>
              {status.provider ? (
                <Badge tone={status.tone}>
                  <span className="sr-only">Provider status: </span>{status.provider}
                </Badge>
              ) : status.app === "Accepted by Resend" ? (
                <span className="text-navy/55">· No delivery update yet</span>
              ) : null}
            </p>
            {status.provider && status.providerAt ? <p className="text-navy/60">{status.provider} {formatDateTime(status.providerAt, timezone)}</p> : null}
          </>
        ) : (
          <p className="text-navy/60">No test email sent yet.</p>
        )}
        <button type="button" onClick={() => void refresh()} disabled={refreshing} className="mt-2 min-h-11 font-medium text-navy underline underline-offset-2 disabled:opacity-50">
          {refreshing ? "Checking…" : "Check delivery status"}
        </button>
      </div>
    </section>
  );
}
