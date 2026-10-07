import "server-only";

import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { formatAddress, SETTINGS_COLUMNS, type ChurchSettings } from "@/lib/data/settings";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { renderEmail, type EmailContent } from "@/lib/email/layout";
import { financeSubmissionSubject, priorityAlert, priorityRowFields } from "@/lib/email/requisition-priority";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { buildReplyAddress } from "@/lib/inbound/address";
import { getSmsProvider, toE164 } from "@/lib/sms";
import { STATUS_LABELS, type RequisitionStatus } from "@/lib/workflow/status";

/**
 * Transactional notifications. Every attempt (sent / skipped / failed) is
 * written to the `notifications` table. Failures never break the workflow
 * action that triggered them.
 */

interface RequisitionNotice {
  id: string;
  requisition_number: string;
  status: RequisitionStatus;
  requester_name: string;
  requester_email: string;
  requester_phone: string;
  submitted_at: string;
  needed_by: string;
  estimated_total: string;
  approved_total: string;
  actual_total: string;
  review_comment: string | null;
  reply_token: string;
  department: string;
  subcategory: string;
  requestType: string;
  workflow: string;
  items: { line_number: number; description: string; quantity: string; estimated_total: string; review_status: string; approved_quantity: string | null; approved_total: string; review_comment: string | null; priority: string; essential_justification: string | null }[];
  prefs: { email_opt_in: boolean; sms_opt_in: boolean; phone: string | null; manage_token: string } | null;
}

async function context() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("church_settings").select(SETTINGS_COLUMNS).eq("id", 1).single();
  const settings = data as ChurchSettings;
  const churchLines = [...formatAddress(settings), settings.phone, settings.email].filter((v): v is string => Boolean(v));
  return { admin, settings, churchLines, appUrl: publicEnv().appUrl };
}

async function loadRequisition(id: string): Promise<RequisitionNotice | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("requisitions")
    .select(
      `id, requisition_number, status, requester_name, requester_email, requester_phone, submitted_at, needed_by,
       estimated_total, approved_total, actual_total, review_comment, reply_token,
       departments(name), department_subcategories(name), request_types(name, workflow),
       requisition_items(line_number, description, quantity, estimated_total, review_status, approved_quantity, approved_total, review_comment, priority, essential_justification),
       notification_preferences(email_opt_in, sms_opt_in, phone, manage_token)`,
    )
    .eq("id", id)
    .single();
  if (!data) return null;
  const d = data as unknown as Record<string, unknown> & {
    departments: { name: string } | null;
    department_subcategories: { name: string } | null;
    request_types: { name: string; workflow: string } | null;
    requisition_items: RequisitionNotice["items"];
    notification_preferences: RequisitionNotice["prefs"] | RequisitionNotice["prefs"][];
  };
  const prefs = Array.isArray(d.notification_preferences) ? d.notification_preferences[0] ?? null : d.notification_preferences;
  return {
    ...(d as unknown as RequisitionNotice),
    department: d.departments?.name ?? "",
    subcategory: d.department_subcategories?.name ?? "",
    requestType: d.request_types?.name ?? "",
    workflow: d.request_types?.workflow ?? "",
    items: [...(d.requisition_items ?? [])].sort((a, b) => a.line_number - b.line_number),
    prefs,
  };
}

async function financeRecipients(admin: ReturnType<typeof createSupabaseAdminClient>, settings: ChurchSettings): Promise<string[]> {
  if (settings.finance_notification_email) {
    return settings.finance_notification_email.split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  }
  const { data: roles } = await admin.from("role_permissions").select("role_id").eq("permission_key", "requisitions.review");
  const { data: adminRole } = await admin.from("roles").select("id").eq("key", "administrator").single();
  const roleIds = [...new Set([...(roles ?? []).map((r) => r.role_id as string), adminRole?.id as string].filter(Boolean))];
  if (roleIds.length === 0) return [];
  const { data: users } = await admin.from("user_roles").select("profiles(email, is_active)").in("role_id", roleIds);
  return [
    ...new Set(
      ((users ?? []) as unknown as { profiles: { email: string; is_active: boolean } | null }[])
        .filter((u) => u.profiles?.is_active)
        .map((u) => u.profiles!.email),
    ),
  ];
}

function log(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  entry: { requisition_id: string | null; channel: "email" | "sms"; template: string; recipient: string; subject?: string; result: SendResult },
) {
  return admin.from("notifications").insert({
    requisition_id: entry.requisition_id,
    channel: entry.channel,
    template: entry.template,
    recipient: entry.recipient.slice(0, 320),
    subject: entry.subject?.slice(0, 300) ?? null,
    status: entry.result.status,
    provider_message_id: entry.result.status === "sent" ? entry.result.id : null,
    error: entry.result.status === "failed" ? entry.result.error.slice(0, 500) : entry.result.status === "skipped" ? entry.result.reason : null,
  });
}

function itemRows(r: RequisitionNotice, currency: string, useApproved: boolean, withPriority = false) {
  return r.items
    .filter((i) => !useApproved || i.review_status === "approved")
    .map((i) => ({
      ...(withPriority ? priorityRowFields(i) : {}),
      description: i.description,
      quantity: useApproved && i.approved_quantity ? stripZeros(i.approved_quantity) : stripZeros(i.quantity),
      amount: formatMoney(useApproved ? i.approved_total : i.estimated_total, currency),
      note: i.review_status !== "approved" && i.review_status !== "pending" && i.review_comment ? `${capitalize(i.review_status)}: ${i.review_comment}` : undefined,
    }));
}

/** Collapses accidental double-sends within the same minute (Resend Idempotency-Key). */
function minuteBucket() {
  return Math.floor(Date.now() / 60_000);
}

function stripZeros(q: string) {
  return String(q).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function sendToRequester(
  r: RequisitionNotice,
  template: string,
  subject: string,
  content: EmailContent,
  opts: { attachments?: { filename: string; content: Buffer }[]; replyTo?: string | null; idempotencyKey: string; sms?: string },
) {
  const { admin, settings, churchLines, appUrl } = await context();
  const manage = r.prefs ? `${appUrl}/notifications/${r.prefs.manage_token}` : null;
  const rendered = renderEmail(
    { ...content, footerNote: content.footerNote ?? (manage ? `Manage email/SMS updates for this request: ${manage}` : undefined) },
    { appUrl, churchName: settings.church_name, churchLines },
  );
  if (r.prefs?.email_opt_in === false) {
    await log(admin, { requisition_id: r.id, channel: "email", template, recipient: r.requester_email, subject, result: { status: "skipped", reason: "Requester opted out of email" } });
  } else {
    const result = await sendEmail({
      to: [r.requester_email],
      subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: opts.replyTo ?? defaultReplyTo(r, settings),
      attachments: opts.attachments,
      idempotencyKey: opts.idempotencyKey,
    });
    await log(admin, { requisition_id: r.id, channel: "email", template, recipient: r.requester_email, subject, result });
  }
  if (opts.sms && r.prefs?.sms_opt_in) {
    const provider = getSmsProvider();
    const to = toE164(r.prefs.phone ?? r.requester_phone); // 10-digit numbers default to +1 (North America)
    let result: SendResult;
    if (!provider) result = { status: "skipped", reason: "SMS provider is not configured" };
    else if (!to) result = { status: "skipped", reason: "Phone number could not be normalised" };
    else {
      try {
        const sent = await provider.send(to, `${settings.church_name}: ${opts.sms} Reply STOP to opt out.`);
        result = { status: "sent", id: sent.id };
      } catch (e) {
        result = { status: "failed", error: (e as Error).message };
      }
    }
    await log(admin, { requisition_id: r.id, channel: "sms", template, recipient: to ?? r.requester_phone, result });
  }
}

function defaultReplyTo(r: RequisitionNotice, settings: ChurchSettings): string | null {
  const base = serverEnv().receiptsInboundAddress;
  return (base && buildReplyAddress(base, { kind: "req", token: r.reply_token })) || settings.email || null;
}

function guard(fn: () => Promise<void>): Promise<void> {
  if (!isAdminClientConfigured()) return Promise.resolve();
  return fn().catch((error) => console.error("[notify]", error));
}

// ---------------------------------------------------------------------------
// Public notification functions
// ---------------------------------------------------------------------------

export function notifyRequisitionSubmitted(requisitionId: string): Promise<void> {
  return guard(async () => {
    const r = await loadRequisition(requisitionId);
    if (!r) return;
    const { admin, settings, churchLines, appUrl } = await context();
    const currency = settings.currency_code;
    const details: [string, string][] = [
      ["Requisition #", r.requisition_number],
      ["Department", `${r.department} · ${r.subcategory}`],
      ["Request type", r.requestType],
      ["Submitted", formatDateTime(r.submitted_at, settings.timezone)],
      ["Date needed", formatDate(r.needed_by, "long")],
      ["Current status", STATUS_LABELS[r.status]],
    ];
    const items = itemRows(r, currency, false, true);
    const total = { label: "Estimated total", amount: formatMoney(r.estimated_total, currency) };

    await sendToRequester(
      r,
      "requisition_submitted",
      `Requisition ${r.requisition_number} received`,
      {
        preheader: `We received your ${r.requestType} request for ${r.department}.`,
        heading: "We received your request",
        paragraphs: [`Thank you, ${r.requester_name}. Your requisition has been submitted to the Finance team for review. You will receive an update when its status changes.`],
        details,
        items,
        itemsTotal: total,
        callout: settings.requisition_policy,
      },
      { idempotencyKey: `req-submitted-${r.id}`, sms: `We received requisition ${r.requisition_number}.` },
    );

    const recipients = await financeRecipients(admin, settings);
    const subject = financeSubmissionSubject(`New requisition ${r.requisition_number} — ${r.department} (${formatMoney(r.estimated_total, currency)})`, r.items);
    const alert = priorityAlert(r.items);
    const rendered = renderEmail(
      {
        preheader: alert ? `${alert.title}: ${r.requester_name} submitted a ${r.requestType} request.` : `${r.requester_name} submitted a ${r.requestType} request.`,
        alert,
        heading: "New requisition to review",
        paragraphs: [`${r.requester_name} (${r.requester_email}) submitted a ${r.requestType} request for ${r.department}.`],
        details: [...details.slice(0, 5), ["Requester phone", r.requester_phone]],
        items,
        itemsTotal: total,
        cta: { label: "Review requisition", url: `${appUrl}/requisitions/${r.id}` },
      },
      { appUrl, churchName: settings.church_name, churchLines },
    );
    if (recipients.length === 0) {
      await log(admin, { requisition_id: r.id, channel: "email", template: "finance_new_requisition", recipient: "finance", subject, result: { status: "skipped", reason: "No finance notification recipients configured" } });
    } else {
      const result = await sendEmail({ to: recipients, subject, html: rendered.html, text: rendered.text, idempotencyKey: `req-finance-${r.id}` });
      await log(admin, { requisition_id: r.id, channel: "email", template: "finance_new_requisition", recipient: recipients.join(", "), subject, result });
    }
  });
}

const STATUS_MESSAGES: Partial<Record<RequisitionStatus, { heading: string; body: string }>> = {
  under_review: { heading: "Your request is under review", body: "The Finance team has started reviewing your requisition." },
  on_hold: { heading: "Your request is on hold", body: "The Finance team has placed your requisition on hold. Please see the comment below and reply to this email if you can help." },
  approved: { heading: "Your request was approved", body: "Your requisition has been approved. You will hear from us about the next step." },
  partially_approved: { heading: "Your request was partially approved", body: "Some of the items in your requisition were approved. The approved items and any notes on the others are listed below." },
  rejected: { heading: "Your request was not approved", body: "Your requisition was not approved. The reason is shown below. Contact the Finance team if you have questions." },
  ordered: { heading: "Your items have been ordered", body: "The church has placed an order for approved items on your requisition." },
  partially_purchased: { heading: "Part of your request is complete", body: "Receipts for some approved items have been reconciled. We will let you know when everything is complete." },
  purchased: { heading: "Purchase completed", body: "All approved items on your requisition have been purchased and reconciled. Thank you for keeping itemized receipts." },
  closed: { heading: "Your request is closed", body: "Your requisition has been closed. No further action is needed." },
};

export function notifyStatusChange(requisitionId: string, status: RequisitionStatus, comment?: string | null): Promise<void> {
  return guard(async () => {
    const message = STATUS_MESSAGES[status];
    if (!message) return;
    const r = await loadRequisition(requisitionId);
    if (!r) return;
    const { settings } = await context();
    const currency = settings.currency_code;
    const showApproved = ["approved", "partially_approved", "ordered", "partially_purchased", "purchased"].includes(status);
    const paragraphs = [message.body];
    if (comment) paragraphs.push(`Comment from Finance: ${comment}`);
    await sendToRequester(
      r,
      `status_${status}`,
      `${r.requisition_number}: ${STATUS_LABELS[status]}`,
      {
        preheader: `${r.requisition_number} is now ${STATUS_LABELS[status]}.`,
        heading: message.heading,
        paragraphs,
        details: [
          ["Requisition #", r.requisition_number],
          ["Department", r.department],
          ["Request type", r.requestType],
          ["Status", STATUS_LABELS[status]],
          ...(showApproved ? ([["Approved amount", formatMoney(r.approved_total, currency)]] as [string, string][]) : []),
          ...(status === "purchased" ? ([["Actual cost", formatMoney(r.actual_total, currency)]] as [string, string][]) : []),
        ],
        items: status === "partially_approved" || status === "rejected" ? itemRows(r, currency, false) : showApproved ? itemRows(r, currency, true) : undefined,
        callout:
          ["approved", "partially_approved"].includes(status) && ["petty_cash", "advance_check"].includes(r.workflow)
            ? "Keep itemized receipts for every purchase and reply to this email with photos or PDFs of them."
            : undefined,
      },
      { idempotencyKey: `req-status-${r.id}-${status}-${minuteBucket()}`, sms: `Requisition ${r.requisition_number} is now ${STATUS_LABELS[status]}.` },
    );
  });
}

export function notifyPurchaseOrderIssued(requisitionId: string, po: { id: string; po_number: string; total: string; reply_token: string; items: { description: string; quantity: string; line_total: string }[] }, pdf: Buffer | null): Promise<void> {
  return guard(async () => {
    const r = await loadRequisition(requisitionId);
    if (!r) return;
    const { settings } = await context();
    const currency = settings.currency_code;
    const base = serverEnv().receiptsInboundAddress;
    const replyTo = base ? buildReplyAddress(base, { kind: "po", token: po.reply_token }) : null;
    await sendToRequester(
      r,
      "po_issued",
      `Purchase Order ${po.po_number} for ${r.requisition_number}`,
      {
        preheader: `Purchase Order ${po.po_number} has been issued (${formatMoney(po.total, currency)}).`,
        heading: "Purchase Order issued",
        paragraphs: [
          `A Purchase Order has been issued for your requisition ${r.requisition_number}.${pdf ? " The PDF is attached." : ""}`,
          settings.po_instructions,
        ],
        details: [
          ["PO number", po.po_number],
          ["Requisition #", r.requisition_number],
          ["Approved amount", formatMoney(po.total, currency)],
        ],
        items: po.items.map((i) => ({ description: i.description, quantity: stripZeros(i.quantity), amount: formatMoney(i.line_total, currency) })),
        itemsTotal: { label: "PO total", amount: formatMoney(po.total, currency) },
        callout: `Keep the itemized receipt or invoice for every purchase. ${replyTo ? "Reply to this email with a photo or PDF of each receipt — it will be filed against this Purchase Order automatically." : "Send each itemized receipt to the Finance team."}`,
      },
      {
        replyTo,
        attachments: pdf ? [{ filename: `${po.po_number}.pdf`, content: pdf }] : undefined,
        idempotencyKey: `po-issued-${po.id}`,
        sms: `Purchase Order ${po.po_number} was issued for ${r.requisition_number}. Check your email.`,
      },
    );
  });
}

export function notifyReceiptReceived(requisitionId: string | null, info: { source: "email" | "upload"; from?: string; unmatched?: boolean }): Promise<void> {
  return guard(async () => {
    const { admin, settings, churchLines, appUrl } = await context();
    const recipients = await financeRecipients(admin, settings);
    const r = requisitionId ? await loadRequisition(requisitionId) : null;
    const subject = r ? `Receipt received for ${r.requisition_number}` : "Unmatched receipt email received";
    const rendered = renderEmail(
      {
        preheader: subject,
        heading: r ? "Receipt ready to reconcile" : "Receipt needs matching",
        paragraphs: [
          r
            ? `A receipt for ${r.requisition_number} (${r.department}) arrived by ${info.source}. It is waiting for reconciliation — nothing is marked purchased until Finance confirms it.`
            : `A receipt email from ${info.from ?? "an unknown sender"} could not be matched to a requisition automatically. Please assign it.`,
        ],
        cta: { label: r ? "Reconcile receipt" : "Open receipts inbox", url: r ? `${appUrl}/requisitions/${r.id}#receipts` : `${appUrl}/receipts` },
      },
      { appUrl, churchName: settings.church_name, churchLines },
    );
    if (recipients.length) {
      const result = await sendEmail({ to: recipients, subject, html: rendered.html, text: rendered.text });
      await log(admin, { requisition_id: r?.id ?? null, channel: "email", template: "finance_receipt_received", recipient: recipients.join(", "), subject, result });
    }
    if (r && info.source === "email") {
      await sendToRequester(
        r,
        "receipt_received",
        `We received your receipt for ${r.requisition_number}`,
        {
          preheader: "Your receipt was received.",
          heading: "Receipt received",
          paragraphs: ["Thank you — your receipt was received and filed with your requisition. The Finance team will reconcile it shortly."],
          details: [["Requisition #", r.requisition_number], ["Status", STATUS_LABELS[r.status]]],
        },
        { idempotencyKey: `receipt-ack-${r.id}-${minuteBucket()}` },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// TEMPORARY — administrator email delivery self-test (lib/email/self-test.ts).
// Remove with that file once the Resend delivery webhook has been verified.
// ---------------------------------------------------------------------------

export const DELIVERY_SELF_TEST = {
  template: "delivery_self_test",
  subject: "The Kings Tribe — Email Delivery Test",
  body: "This is a controlled email delivery test for The Kings Tribe Operations notification system. No action is required.",
} as const;

/**
 * Sends the fixed delivery-test email through the same renderer, Resend sender
 * and `notifications` log as every application email, so the provider message
 * id is stored and matched by the delivery webhook exactly as usual. Not linked
 * to any requisition. One send, no retry. The caller decides the recipient.
 */
export async function sendDeliverySelfTestEmail(recipient: string, idempotencyKey: string): Promise<{ result: SendResult; logged: boolean }> {
  const { admin, settings, churchLines, appUrl } = await context();
  const rendered = renderEmail(
    { preheader: DELIVERY_SELF_TEST.body, heading: "Email delivery test", paragraphs: [DELIVERY_SELF_TEST.body] },
    { appUrl, churchName: settings.church_name, churchLines },
  );
  const result = await sendEmail({ to: [recipient], subject: DELIVERY_SELF_TEST.subject, html: rendered.html, text: rendered.text, idempotencyKey });
  const { error } = await log(admin, { requisition_id: null, channel: "email", template: DELIVERY_SELF_TEST.template, recipient, subject: DELIVERY_SELF_TEST.subject, result });
  return { result, logged: !error };
}
