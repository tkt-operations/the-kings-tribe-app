/**
 * Renders the requester emails for training screenshot S54 — RENDER ONLY, never sent.
 *
 * Uses the application's real email template (lib/email/layout.ts renderEmail)
 * and builds each email's content exactly as lib/notify.ts does for
 * notifyRequisitionSubmitted, notifyStatusChange and notifyPurchaseOrderIssued.
 * Input is a JSON snapshot of fictional TRAINING records (see README.md); the
 * personal "manage updates" link is replaced with a placeholder so no token
 * appears in an image. Writes one HTML file per email to the output directory.
 *
 * Usage: node <bundled script> <data.json> <out-dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderEmail, type EmailContent } from "@/lib/email/layout";
import { priorityRowFields } from "@/lib/email/requisition-priority";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { STATUS_LABELS, type RequisitionStatus } from "@/lib/workflow/status";
import type { Priority } from "@/lib/priority";

type Item = { line_number: number; description: string; quantity: string; estimated_total: string; review_status: string; approved_quantity: string | null; approved_total: string; review_comment: string | null; priority: Priority; essential_justification: string | null };
type Req = { requisition_number: string; status: RequisitionStatus; requester_name: string; requester_email: string; submitted_at: string; needed_by: string; estimated_total: string; approved_total: string; actual_total: string; department: string; subcategory: string; requestType: string; workflow: string; items: Item[] };
type Settings = { church_name: string; currency_code: string; timezone: string; requisition_policy: string; po_instructions: string; churchLines: string[] };
type Data = { appUrl: string; settings: Settings; submitted: Req; partial: Req & { review_comment: string | null }; po: { req: Req; po_number: string; total: string; items: { description: string; quantity: string; line_total: string }[] }; purchased: Req };

const MANAGE_PLACEHOLDER = "Manage email/SMS updates for this request: [personal link — removed in this training image]";
const stripZeros = (q: string) => String(q).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// lib/notify.ts itemRows
function itemRows(r: Req, currency: string, useApproved: boolean, withPriority = false) {
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

// lib/notify.ts STATUS_MESSAGES (the statuses rendered here)
const STATUS_MESSAGES: Partial<Record<RequisitionStatus, { heading: string; body: string }>> = {
  partially_approved: { heading: "Your request was partially approved", body: "Some of the items in your requisition were approved. The approved items and any notes on the others are listed below." },
  purchased: { heading: "Purchase completed", body: "All approved items on your requisition have been purchased and reconciled. Thank you for keeping itemized receipts." },
};

function submitted(d: Data): [string, EmailContent] {
  const { settings: s } = d; const r = d.submitted; const currency = s.currency_code;
  return [`Requisition ${r.requisition_number} received`, {
    preheader: `We received your ${r.requestType} request for ${r.department}.`,
    heading: "We received your request",
    paragraphs: [`Thank you, ${r.requester_name}. Your requisition has been submitted to the Finance team for review. You will receive an update when its status changes.`],
    details: [
      ["Requisition #", r.requisition_number], ["Department", `${r.department} · ${r.subcategory}`], ["Request type", r.requestType],
      ["Submitted", formatDateTime(r.submitted_at, s.timezone)], ["Date needed", formatDate(r.needed_by, "long")], ["Current status", STATUS_LABELS.submitted],
    ],
    items: itemRows(r, currency, false, true),
    itemsTotal: { label: "Estimated total", amount: formatMoney(r.estimated_total, currency) },
    callout: s.requisition_policy,
  }];
}

function statusChange(d: Data, r: Req, status: RequisitionStatus, comment: string | null): [string, EmailContent] {
  const currency = d.settings.currency_code; const message = STATUS_MESSAGES[status]!;
  const showApproved = ["approved", "partially_approved", "ordered", "partially_purchased", "purchased"].includes(status);
  const paragraphs = [message.body];
  if (comment) paragraphs.push(`Comment from Finance: ${comment}`);
  return [`${r.requisition_number}: ${STATUS_LABELS[status]}`, {
    preheader: `${r.requisition_number} is now ${STATUS_LABELS[status]}.`,
    heading: message.heading,
    paragraphs,
    details: [
      ["Requisition #", r.requisition_number], ["Department", r.department], ["Request type", r.requestType], ["Status", STATUS_LABELS[status]],
      ...(showApproved ? ([["Approved amount", formatMoney(r.approved_total, currency)]] as [string, string][]) : []),
      ...(status === "purchased" ? ([["Actual cost", formatMoney(r.actual_total, currency)]] as [string, string][]) : []),
    ],
    items: status === "partially_approved" || status === "rejected" ? itemRows(r, currency, false) : showApproved ? itemRows(r, currency, true) : undefined,
    callout: ["approved", "partially_approved"].includes(status) && ["petty_cash", "advance_check"].includes(r.workflow)
      ? "Keep itemized receipts for every purchase and reply to this email with photos or PDFs of them." : undefined,
  }];
}

function poIssued(d: Data): [string, EmailContent] {
  const { req: r, po_number, total, items } = d.po; const currency = d.settings.currency_code;
  // Training has no inbound receipt address, so the callout takes the no-reply-address wording, as lib/notify.ts does.
  return [`Purchase Order ${po_number} for ${r.requisition_number}`, {
    preheader: `Purchase Order ${po_number} has been issued (${formatMoney(total, currency)}).`,
    heading: "Purchase Order issued",
    paragraphs: [`A Purchase Order has been issued for your requisition ${r.requisition_number}. The PDF is attached.`, d.settings.po_instructions],
    details: [["PO number", po_number], ["Requisition #", r.requisition_number], ["Approved amount", formatMoney(total, currency)]],
    items: items.map((i) => ({ description: i.description, quantity: stripZeros(i.quantity), amount: formatMoney(i.line_total, currency) })),
    itemsTotal: { label: "PO total", amount: formatMoney(total, currency) },
    callout: "Keep the itemized receipt or invoice for every purchase. Send each itemized receipt to the Finance team.",
  }];
}

const [, , dataFile, outDir] = process.argv;
const d = JSON.parse(readFileSync(dataFile, "utf8")) as Data;
mkdirSync(outDir, { recursive: true });
const emails: [string, string, [string, EmailContent]][] = [
  ["01-request-received", d.submitted.requester_email, submitted(d)],
  ["02-partially-approved", d.partial.requester_email, statusChange(d, d.partial, "partially_approved", d.partial.review_comment)],
  ["03-po-issued", d.po.req.requester_email, poIssued(d)],
  ["04-purchased", d.purchased.requester_email, statusChange(d, d.purchased, "purchased", null)],
];
for (const [name, to, [subject, content]] of emails) {
  const { html } = renderEmail({ ...content, footerNote: MANAGE_PLACEHOLDER }, { appUrl: d.appUrl, churchName: d.settings.church_name, churchLines: d.settings.churchLines });
  writeFileSync(path.join(outDir, `${name}.html`), html);
  writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ subject, to }));
}
console.log(`Rendered ${emails.length} training emails (not sent).`);
