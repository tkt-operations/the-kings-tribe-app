import { NextResponse, type NextRequest } from "next/server";
import { parseDeliveryEvent } from "@/lib/email/delivery-events";
import { verifySvixSignature } from "@/lib/inbound/svix";
import { serverEnv } from "@/lib/server-env";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Resend delivery-status webhook (email.sent / delivered / delivery_delayed /
 * bounced / complained / failed / suppressed).
 *  - Rejects anything without a valid Svix signature (RESEND_DELIVERY_WEBHOOK_SECRET).
 *  - Matches ONLY on the provider message id stored when Resend accepted the email.
 *  - Idempotent on the Svix message id; out-of-order safe (precedence in the DB).
 *  - Stores no recipients, subjects or bodies.
 */
export async function POST(request: NextRequest) {
  const secret = serverEnv().resendDeliveryWebhookSecret;
  if (!secret || !isAdminClientConfigured()) {
    return NextResponse.json({ error: "Delivery tracking is not configured" }, { status: 503 });
  }
  const body = await request.text();
  if (body.length > 64_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const eventId = request.headers.get("svix-id");
  const verified = verifySvixSignature({
    id: eventId,
    timestamp: request.headers.get("svix-timestamp"),
    signatureHeader: request.headers.get("svix-signature"),
    body,
    secret,
  });
  if (!verified.ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const event = parseDeliveryEvent(payload);
  if (event.kind === "ignored") return NextResponse.json({ result: "ignored" });
  if (event.kind === "invalid") return NextResponse.json({ error: "Invalid event" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("record_email_delivery_event", {
    p_provider_event_id: eventId,
    p_provider_message_id: event.emailId,
    p_event_type: event.status,
    p_occurred_at: event.occurredAt,
    p_detail: event.detail,
  });
  if (error) {
    // 5xx lets Resend retry; idempotency makes retries safe.
    console.error("email-events: could not record event", { code: error.code, status: event.status });
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }
  return NextResponse.json({ result: (data as { result?: string } | null)?.result ?? "recorded" });
}
