import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySvixSignature } from "@/lib/inbound/svix";
import { matchInboundEmail, type MatchLookups } from "@/lib/inbound/match";

const secretBytes = Buffer.from("super-secret-signing-key-material");
const secret = `whsec_${secretBytes.toString("base64")}`;
function sign(id: string, ts: string, body: string) {
  return `v1,${createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

describe("svix webhook signatures", () => {
  const body = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
  const ts = "1760000000";
  it("accepts a valid signature (including among several)", () => {
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signatureHeader: sign("msg_1", ts, body), body, secret, nowSeconds: 1760000010 })).toEqual({ ok: true });
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signatureHeader: `v1,AAAA ${sign("msg_1", ts, body)}`, body, secret, nowSeconds: 1760000010 }).ok).toBe(true);
  });
  it("rejects tampering, replay and missing headers", () => {
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signatureHeader: sign("msg_1", ts, body), body: body + " ", secret, nowSeconds: 1760000010 }).ok).toBe(false);
    expect(verifySvixSignature({ id: "msg_2", timestamp: ts, signatureHeader: sign("msg_1", ts, body), body, secret, nowSeconds: 1760000010 }).ok).toBe(false);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signatureHeader: sign("msg_1", ts, body), body, secret, nowSeconds: 1760009999 })).toEqual({ ok: false, reason: "timestamp outside tolerance" });
    expect(verifySvixSignature({ id: null, timestamp: ts, signatureHeader: "x", body, secret }).ok).toBe(false);
    expect(verifySvixSignature({ id: "msg_1", timestamp: ts, signatureHeader: sign("msg_1", ts, body), body, secret: "whsec_" + Buffer.from("other").toString("base64"), nowSeconds: 1760000010 }).ok).toBe(false);
  });
});

describe("inbound email matching", () => {
  const token = "0123456789abcdef01234567";
  const lookups: MatchLookups = {
    poByToken: async (t) => (t === token ? { id: "po-1", requisitionId: "req-1", requesterEmail: "jordan@example.org" } : null),
    requisitionByToken: async (t) => (t === token ? { id: "req-2", requesterEmail: "sam@example.org" } : null),
    poByNumber: async (n) => (n === "TKT-PO-2026-0007" ? { id: "po-7", requisitionId: "req-7", requesterEmail: "jordan@example.org" } : null),
    requisitionByNumber: async (n) => (n === "TKT-REQ-2026-0042" ? { id: "req-42", requesterEmail: "jordan@example.org" } : null),
  };

  it("matches by reply address first, regardless of sender", async () => {
    expect(await matchInboundEmail({ from: "anyone@else.org", to: [`receipts+po-${token}@inbound.example.org`], subject: "receipt" }, lookups))
      .toEqual({ requisitionId: "req-1", purchaseOrderId: "po-1", method: "reply-address" });
    expect(await matchInboundEmail({ from: "x@y.org", to: ["receipts@inbound.example.org"], receivedFor: [`receipts+req-${token}@inbound.example.org`], subject: "" }, lookups))
      .toMatchObject({ requisitionId: "req-2", method: "reply-address" });
  });

  it("matches document numbers only when the sender is the requester", async () => {
    expect(await matchInboundEmail({ from: "Jordan <JORDAN@example.org>", to: ["receipts@x.org"], subject: "Re: Purchase Order TKT-PO-2026-0007" }, lookups))
      .toEqual({ requisitionId: "req-7", purchaseOrderId: "po-7", method: "po-number+sender" });
    expect(await matchInboundEmail({ from: "stranger@evil.example", to: ["receipts@x.org"], subject: "TKT-PO-2026-0007" }, lookups))
      .toEqual({ requisitionId: null, purchaseOrderId: null, method: "po-number-sender-mismatch" });
    expect(await matchInboundEmail({ from: "jordan@example.org", to: ["receipts@x.org"], subject: "receipt", text: "for TKT-REQ-2026-0042 thanks" }, lookups))
      .toMatchObject({ requisitionId: "req-42", method: "requisition-number+sender" });
  });

  it("leaves everything else unmatched", async () => {
    expect(await matchInboundEmail({ from: "jordan@example.org", to: ["receipts@x.org"], subject: "my receipt" }, lookups)).toMatchObject({ requisitionId: null, method: "none" });
    expect(await matchInboundEmail({ from: "a@b.org", to: [`receipts+po-ffffffffffffffffffffffff@x.org`], subject: "" }, lookups)).toMatchObject({ requisitionId: null });
  });
});
