import { randomUUID } from "node:crypto";
import { NextResponse, after, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/server-env";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { verifySvixSignature } from "@/lib/inbound/svix";
import { matchInboundEmail } from "@/lib/inbound/match";
import { downloadAttachment, getReceivedEmail, listReceivedAttachments } from "@/lib/inbound/resend";
import { checkReceiptFile, RECEIPT_MAX_BYTES, RECEIPT_MAX_FILES } from "@/lib/receipt-files";
import { notifyReceiptReceived } from "@/lib/notify";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Resend inbound webhook (event "email.received").
 *  - Rejects anything without a valid Svix signature.
 *  - Idempotent: a provider message id is processed once (DB unique key).
 *  - Matches the email to a PO / requisition deterministically.
 *  - Stores supported attachments privately and queues a PENDING receipt.
 *    Nothing is marked purchased until Finance reconciles it.
 */
export async function POST(request: NextRequest) {
  const env = serverEnv();
  if (!env.resendWebhookSecret || !env.resendApiKey || !isAdminClientConfigured()) {
    return NextResponse.json({ error: "Inbound email is not configured" }, { status: 503 });
  }

  const body = await request.text();
  if (body.length > 256_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const verified = verifySvixSignature({
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signatureHeader: request.headers.get("svix-signature"),
    body,
    secret: env.resendWebhookSecret,
  });
  if (!verified.ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (event.type !== "email.received") return NextResponse.json({ ignored: true });
  const emailId = String(event.data?.email_id ?? "");
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(emailId)) return NextResponse.json({ error: "Invalid email id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin.from("inbound_emails").select("id").eq("provider", "resend").eq("provider_message_id", emailId).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true });

  const email = await getReceivedEmail(emailId);
  const match = await matchInboundEmail(
    { from: email.from, to: email.to ?? [], cc: email.cc ?? [], receivedFor: email.received_for ?? [], subject: email.subject ?? "", text: email.text },
    {
      async poByToken(token) {
        const { data } = await admin.from("purchase_orders").select("id, requisition_id, requisitions(requester_email)").eq("reply_token", token).maybeSingle();
        return data ? { id: data.id as string, requisitionId: data.requisition_id as string, requesterEmail: (data.requisitions as unknown as { requester_email: string })?.requester_email ?? "" } : null;
      },
      async requisitionByToken(token) {
        const { data } = await admin.from("requisitions").select("id, requester_email").eq("reply_token", token).maybeSingle();
        return data ? { id: data.id as string, requesterEmail: data.requester_email as string } : null;
      },
      async poByNumber(number) {
        const { data } = await admin.from("purchase_orders").select("id, requisition_id, requisitions(requester_email)").eq("po_number", number).maybeSingle();
        return data ? { id: data.id as string, requisitionId: data.requisition_id as string, requesterEmail: (data.requisitions as unknown as { requester_email: string })?.requester_email ?? "" } : null;
      },
      async requisitionByNumber(number) {
        const { data } = await admin.from("requisitions").select("id, requester_email").eq("requisition_number", number).maybeSingle();
        return data ? { id: data.id as string, requesterEmail: data.requester_email as string } : null;
      },
    },
  );

  // Store supported attachments (skip inline signatures/logos and anything not a receipt type).
  const attachments = (await listReceivedAttachments(emailId)).slice(0, 20);
  const stored: { path: string; original_filename: string }[] = [];
  const safeId = emailId.replace(/[^A-Za-z0-9_-]/g, "");
  for (const attachment of attachments) {
    if (stored.length >= RECEIPT_MAX_FILES) break;
    const check = checkReceiptFile({ name: attachment.filename ?? "", type: attachment.content_type ?? "", size: attachment.size ?? 0 });
    if (!check.ok) continue;
    if (attachment.content_disposition === "inline" && check.mime.startsWith("image/") && attachment.size < 20_000) continue; // signature logos
    try {
      const content = await downloadAttachment(attachment.download_url, RECEIPT_MAX_BYTES);
      const path = `inbound/${safeId}/${randomUUID()}.${check.ext}`;
      const { error } = await admin.storage.from("receipts").upload(path, content, { contentType: check.mime, upsert: false });
      if (!error) stored.push({ path, original_filename: attachment.filename.slice(0, 255) });
    } catch (error) {
      console.error("[inbound-email] attachment skipped", (error as Error).message);
    }
  }

  const { data: result, error } = await admin.rpc("ingest_inbound_email", {
    p_email: {
      provider: "resend",
      provider_message_id: emailId,
      message_id_header: email.message_id,
      from: email.from,
      to: email.to ?? [],
      subject: email.subject ?? "",
      text_excerpt: (email.text ?? "").slice(0, 4000),
    },
    p_match: { requisition_id: match.requisitionId, purchase_order_id: match.purchaseOrderId, method: match.method },
    p_files: stored,
  });
  if (error) {
    console.error("[inbound-email] ingest failed", error.message);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 }); // Svix will retry
  }
  const r = result as { duplicate: boolean; receipt_id: string | null; requisition_id: string | null; status: string };
  if (!r.duplicate && r.receipt_id) {
    after(() => notifyReceiptReceived(r.requisition_id, { source: "email", from: email.from, unmatched: !r.requisition_id }));
  }
  return NextResponse.json({ ok: true, status: r.status ?? "duplicate" });
}
