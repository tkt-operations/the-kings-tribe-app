/**
 * Needs Attention cards — "what still requires action", derived LIVE from
 * workflow state by public.my_needs_attention() (no notification records).
 * Client-safe definitions shared by the dashboard and the requisition list.
 */

export const REQUISITION_ATTENTION_CARDS = [
  "awaiting_review", "on_hold", "ready_for_po", "ready_to_order", "awaiting_receipts", "ready_for_disbursement",
] as const;
export type RequisitionAttentionCard = (typeof REQUISITION_ATTENTION_CARDS)[number];
export type AttentionCardKey = RequisitionAttentionCard | "receipts_to_reconcile";

export const ATTENTION_LABELS: Record<AttentionCardKey, { title: string; hint: string }> = {
  awaiting_review: { title: "Awaiting review", hint: "Submitted or under review" },
  on_hold: { title: "On hold", hint: "Waiting on more information" },
  ready_for_po: { title: "Ready for PO", hint: "Approved — Purchase Order not issued yet" },
  ready_to_order: { title: "Ready to order", hint: "PO issued — nothing ordered yet" },
  awaiting_receipts: { title: "Awaiting receipts", hint: "Purchasing under way — no receipt to reconcile yet" },
  ready_for_disbursement: { title: "Ready for disbursement", hint: "Funds or reimbursement to pay out" },
  receipts_to_reconcile: { title: "Receipts to reconcile", hint: "Pending receipts on approved requisitions" },
};

export function isRequisitionAttentionCard(value: unknown): value is RequisitionAttentionCard {
  return typeof value === "string" && (REQUISITION_ATTENTION_CARDS as readonly string[]).includes(value);
}

export interface AttentionCard {
  key: AttentionCardKey;
  title: string;
  hint: string;
  count: number;
  href: string;
  /** Extra facts, e.g. "2 Essential", "1 assigned to you", "1 unmatched". */
  details: string[];
  emphasis: boolean;
}

type Raw = Partial<Record<AttentionCardKey, { count?: number; essential?: number; assigned_to_me?: number; unmatched?: number; oldest?: string | null }>>;

const ORDER: AttentionCardKey[] = ["awaiting_review", "receipts_to_reconcile", "ready_for_po", "ready_to_order", "ready_for_disbursement", "awaiting_receipts", "on_hold"];

/** Turn the RPC result into cards (only keys the user may act on are present). */
export function toAttentionCards(raw: unknown): AttentionCard[] {
  const data = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const cards: AttentionCard[] = [];
  for (const key of ORDER) {
    const v = data[key];
    if (!v) continue;
    const count = Number(v.count ?? 0);
    const details: string[] = [];
    if (key === "awaiting_review") {
      if (v.essential) details.push(`${v.essential} Essential`);
      if (v.assigned_to_me) details.push(`${v.assigned_to_me} assigned to you`);
    }
    const unmatched = Number(v.unmatched ?? 0);
    if (key === "receipts_to_reconcile" && unmatched) details.push(`${unmatched} unmatched`);
    cards.push({
      key,
      ...ATTENTION_LABELS[key],
      count: key === "receipts_to_reconcile" ? count + unmatched : count,
      href: key === "receipts_to_reconcile" ? "/receipts" : `/requisitions?attention=${key}`,
      details,
      emphasis: key === "awaiting_review" && Number(v.essential ?? 0) > 0,
    });
  }
  return cards;
}
