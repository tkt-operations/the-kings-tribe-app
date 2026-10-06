import { escapeHtml, safeUrl } from "./escape";

/**
 * Reusable branded email layout. Table-based for email-client compatibility.
 * Brand: Deep Navy header carrying the OFFICIAL gold/white primary logo (PNG,
 * unmodified, hosted with the app), DM Serif headline with Georgia fallback
 * (most clients block web fonts), Satoshi body falling back to Helvetica/Arial.
 */
export interface EmailContent {
  preheader: string;
  heading: string;
  paragraphs: string[];          // plain text, escaped
  details?: [string, string][];  // label/value rows
  items?: {
    description: string;
    quantity: string;
    amount: string;
    note?: string;
    /** Line-item priority label, e.g. "ESSENTIAL" (always shown as words, not just colour). */
    priority?: { label: string; tone: "essential" | "high" | "medium" | "low" };
    /** Extra emphasised line under the item, e.g. the Essential justification. */
    priorityNote?: string;
  }[];
  /** Prominent notice above the message, e.g. "ESSENTIAL ITEM INCLUDED". */
  alert?: { title: string; body: string; tone: "essential" | "high" };
  itemsTotal?: { label: string; amount: string };
  callout?: string;              // highlighted instruction (plain text)
  cta?: { label: string; url: string };
  footerNote?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const NAVY = "#12172D";
const GOLD = "#F3C94A";
const GRAY = "#EDF0F4";
const SERIF = "'DM Serif Display', Georgia, 'Times New Roman', serif";
const SANS = "Satoshi, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const ORANGE = "#FD5820";

// Priority pills: words + weight + colour (navy text keeps contrast on orange/gold).
const PILL: Record<"essential" | "high" | "medium" | "low", string> = {
  essential: `background:${ORANGE};color:${NAVY};border:1px solid ${ORANGE};`,
  high: `background:#FCEFC4;color:${NAVY};border:1px solid ${GOLD};`,
  medium: `background:${GRAY};color:${NAVY};border:1px solid ${GRAY};`,
  low: `background:#ffffff;color:#5a5f70;border:1px solid #d5d9e0;`,
};

export function renderEmail(content: EmailContent, opts: { appUrl: string; churchName: string; churchLines: string[] }): RenderedEmail {
  const logo = `${opts.appUrl}/brand/logo-primary-gold-on-navy.png`;
  const alert = content.alert
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="border-left:6px solid ${content.alert.tone === "essential" ? ORANGE : GOLD};background:${content.alert.tone === "essential" ? "#FFE9E0" : "#FDF6DE"};padding:14px 16px;">
<p style="margin:0 0 4px;font:bold 15px/1.3 ${SANS};color:${NAVY};letter-spacing:.08em;text-transform:uppercase;">${content.alert.tone === "essential" ? "&#9888;&#65039; " : ""}${escapeHtml(content.alert.title)}</p>
<p style="margin:0;font:14px/1.55 ${SANS};color:${NAVY};">${escapeHtml(content.alert.body)}</p></td></tr></table>`
    : "";
  const p = content.paragraphs
    .map((t) => `<p style="margin:0 0 16px;font:16px/1.6 ${SANS};color:${NAVY};">${escapeHtml(t)}</p>`)
    .join("");
  const details = content.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;border-collapse:collapse;">${content.details
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid ${GRAY};font:14px ${SANS};color:#5a5f70;width:42%;">${escapeHtml(k)}</td><td style="padding:8px 0;border-bottom:1px solid ${GRAY};font:bold 14px ${SANS};color:${NAVY};text-align:right;">${escapeHtml(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const items = content.items?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;border-collapse:collapse;">
        <tr><td style="padding:8px 10px;background:${GRAY};font:bold 12px ${SANS};color:${NAVY};text-transform:uppercase;letter-spacing:.06em;">Item</td><td style="padding:8px 10px;background:${GRAY};font:bold 12px ${SANS};color:${NAVY};text-align:right;">Qty</td><td style="padding:8px 10px;background:${GRAY};font:bold 12px ${SANS};color:${NAVY};text-align:right;">Amount</td></tr>
        ${content.items
          .map(
            (i) =>
              `<tr><td style="padding:10px;border-bottom:1px solid ${GRAY};font:14px ${SANS};color:${NAVY};">${i.priority ? `<span style="display:inline-block;margin:0 0 4px;padding:2px 8px;border-radius:999px;font:bold 11px ${SANS};letter-spacing:.08em;text-transform:uppercase;${PILL[i.priority.tone]}">${escapeHtml(i.priority.label)}</span><br>` : ""}${escapeHtml(i.description)}${i.priorityNote ? `<br><span style="display:inline-block;margin-top:4px;font-size:13px;color:${NAVY};"><strong>${escapeHtml(i.priorityNote)}</strong></span>` : ""}${i.note ? `<br><span style="color:#5a5f70;font-size:12px;">${escapeHtml(i.note)}</span>` : ""}</td><td style="padding:10px;border-bottom:1px solid ${GRAY};font:14px ${SANS};color:${NAVY};text-align:right;">${escapeHtml(i.quantity)}</td><td style="padding:10px;border-bottom:1px solid ${GRAY};font:14px ${SANS};color:${NAVY};text-align:right;">${escapeHtml(i.amount)}</td></tr>`,
          )
          .join("")}
        ${content.itemsTotal ? `<tr><td colspan="2" style="padding:12px 10px;font:bold 14px ${SANS};color:${NAVY};">${escapeHtml(content.itemsTotal.label)}</td><td style="padding:12px 10px;font:bold 16px ${SANS};color:${NAVY};text-align:right;">${escapeHtml(content.itemsTotal.amount)}</td></tr>` : ""}
      </table>`
    : "";
  const callout = content.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px;"><tr><td style="border-left:4px solid ${GOLD};background:#FDF6DE;padding:14px 16px;font:14px/1.55 ${SANS};color:${NAVY};">${escapeHtml(content.callout)}</td></tr></table>`
    : "";
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="background:${NAVY};border-radius:10px;"><a href="${safeUrl(content.cta.url)}" style="display:inline-block;padding:13px 22px;font:bold 15px ${SANS};color:${GOLD};text-decoration:none;">${escapeHtml(content.cta.label)}</a></td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.heading)}</title></head>
<body style="margin:0;padding:0;background:${GRAY};">
<span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${escapeHtml(content.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${GRAY};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
<tr><td align="center" style="background:${NAVY};padding:28px 24px;"><img src="${escapeHtml(logo)}" width="112" alt="${escapeHtml(opts.churchName)}" style="display:block;width:112px;height:auto;border:0;"></td></tr>
<tr><td style="padding:32px 28px 8px;">
<h1 style="margin:0 0 6px;font:normal 28px/1.2 ${SERIF};color:${NAVY};">${escapeHtml(content.heading)}</h1>
<div style="width:48px;height:3px;background:${GOLD};border-radius:2px;margin:12px 0 22px;"></div>
${alert}${p}${details}${items}${callout}${cta}
</td></tr>
<tr><td style="padding:20px 28px 28px;border-top:1px solid ${GRAY};font:12px/1.6 ${SANS};color:#5a5f70;">
${content.footerNote ? `${escapeHtml(content.footerNote)}<br><br>` : ""}<strong style="color:${NAVY};">${escapeHtml(opts.churchName)}</strong><br>${opts.churchLines.map(escapeHtml).join("<br>")}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    ...(content.alert ? [`*** ${content.alert.title.toUpperCase()} ***`, content.alert.body, ""] : []),
    content.heading,
    "",
    ...content.paragraphs,
    "",
    ...(content.details ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(content.items?.length
      ? ["", "Items:", ...content.items.flatMap((i) => [
          `- ${i.priority ? `[${i.priority.label}] ` : ""}${i.description} × ${i.quantity} — ${i.amount}`,
          ...(i.priorityNote ? [`  ${i.priorityNote}`] : []),
          ...(i.note ? [`  ${i.note}`] : []),
        ])]
      : []),
    ...(content.itemsTotal ? [`${content.itemsTotal.label}: ${content.itemsTotal.amount}`] : []),
    ...(content.callout ? ["", content.callout] : []),
    ...(content.cta ? ["", `${content.cta.label}: ${content.cta.url}`] : []),
    "",
    ...(content.footerNote ? [content.footerNote, ""] : []),
    opts.churchName,
    ...opts.churchLines,
  ].join("\n");

  return { html, text };
}
