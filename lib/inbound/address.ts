/**
 * Deterministic reply addresses for receipts, e.g.
 *   receipts+po-3f9a…@inbound.example.org   (a Purchase Order)
 *   receipts+req-8c1d…@inbound.example.org  (a requisition)
 * The token is a random 24-hex value stored on the PO / requisition.
 */
export type ReplyTarget = { kind: "po" | "req"; token: string };

const TOKEN = /^[0-9a-f]{24}$/;

export function buildReplyAddress(baseAddress: string, target: ReplyTarget): string | null {
  const match = /^([^@+\s]+)@([^@\s]+)$/.exec(baseAddress.trim());
  if (!match || !TOKEN.test(target.token)) return null;
  return `${match[1]}+${target.kind}-${target.token}@${match[2]}`;
}

/** Extract a reply target from any recipient address (to / cc / received_for). */
export function parseReplyAddress(address: string): ReplyTarget | null {
  const email = /<([^>]+)>/.exec(address)?.[1] ?? address;
  const match = /^[^@+\s]+\+(po|req)-([0-9a-f]{24})@[^@\s]+$/i.exec(email.trim());
  if (!match) return null;
  return { kind: match[1].toLowerCase() as "po" | "req", token: match[2].toLowerCase() };
}

const PO_NUMBER = /\bTKT-PO-(\d{4})-(\d{4,})\b/i;
const REQ_NUMBER = /\bTKT-REQ-(\d{4})-(\d{4,})\b/i;

export function findDocumentNumbers(text: string): { poNumber: string | null; requisitionNumber: string | null } {
  const po = PO_NUMBER.exec(text);
  const req = REQ_NUMBER.exec(text);
  return {
    poNumber: po ? `TKT-PO-${po[1]}-${po[2]}` : null,
    requisitionNumber: req ? `TKT-REQ-${req[1]}-${req[2]}` : null,
  };
}

/** Extract the bare email address from "Name <a@b.c>". */
export function bareEmail(value: string | null | undefined): string {
  if (!value) return "";
  return (/<([^>]+)>/.exec(value)?.[1] ?? value).trim().toLowerCase();
}
