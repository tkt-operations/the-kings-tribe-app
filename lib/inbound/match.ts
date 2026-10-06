import { bareEmail, findDocumentNumbers, parseReplyAddress } from "./address";

export interface InboundEnvelope {
  from: string;
  to: string[];
  cc?: string[];
  receivedFor?: string[];
  subject: string;
  text?: string | null;
}

export interface MatchLookups {
  poByToken(token: string): Promise<{ id: string; requisitionId: string; requesterEmail: string } | null>;
  requisitionByToken(token: string): Promise<{ id: string; requesterEmail: string } | null>;
  poByNumber(number: string): Promise<{ id: string; requisitionId: string; requesterEmail: string } | null>;
  requisitionByNumber(number: string): Promise<{ id: string; requesterEmail: string } | null>;
}

export interface MatchResult {
  requisitionId: string | null;
  purchaseOrderId: string | null;
  method: string;
}

/**
 * Deterministic matching, strongest signal first:
 *  1. the secret reply token in the plus-address we put on outgoing emails;
 *  2. a PO / requisition number in the subject or body — accepted ONLY when
 *     the sender is the requester on file (free text alone is not trusted).
 */
export async function matchInboundEmail(email: InboundEnvelope, lookups: MatchLookups): Promise<MatchResult> {
  const recipients = [...email.to, ...(email.cc ?? []), ...(email.receivedFor ?? [])];
  for (const address of recipients) {
    const target = parseReplyAddress(address);
    if (!target) continue;
    if (target.kind === "po") {
      const po = await lookups.poByToken(target.token);
      if (po) return { requisitionId: po.requisitionId, purchaseOrderId: po.id, method: "reply-address" };
    } else {
      const req = await lookups.requisitionByToken(target.token);
      if (req) return { requisitionId: req.id, purchaseOrderId: null, method: "reply-address" };
    }
  }

  const sender = bareEmail(email.from);
  const numbers = findDocumentNumbers(`${email.subject}\n${(email.text ?? "").slice(0, 20_000)}`);
  if (numbers.poNumber) {
    const po = await lookups.poByNumber(numbers.poNumber);
    if (po && bareEmail(po.requesterEmail) === sender) return { requisitionId: po.requisitionId, purchaseOrderId: po.id, method: "po-number+sender" };
    if (po) return { requisitionId: null, purchaseOrderId: null, method: "po-number-sender-mismatch" };
  }
  if (numbers.requisitionNumber) {
    const req = await lookups.requisitionByNumber(numbers.requisitionNumber);
    if (req && bareEmail(req.requesterEmail) === sender) return { requisitionId: req.id, purchaseOrderId: null, method: "requisition-number+sender" };
    if (req) return { requisitionId: null, purchaseOrderId: null, method: "requisition-number-sender-mismatch" };
  }
  return { requisitionId: null, purchaseOrderId: null, method: "none" };
}
