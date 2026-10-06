import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, lookup, payload, putObject, rpc, submit } from "./fixtures";

let db: Db;
let headId: string;
let ids: Awaited<ReturnType<typeof lookup>>;
let tokenId: string;
let churchToday: Date;

function daysFromNow(days: number): string {
  const d = new Date(churchToday);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, "admin@example.org", ["administrator"]);
  headId = await createUser(db, "head@example.org", ["head_of_finance"]);
  ids = await lookup(db);
  tokenId = await createFormToken(db);
  const t = await one<{ d: string }>(db, "select private.church_today()::text as d");
  churchToday = new Date(`${t.d}T00:00:00Z`);
});

async function req(id: string) {
  return one<{ status: string; estimated_total: string; approved_total: string; actual_total: string; review_outcome: string | null }>(
    db,
    "select status, estimated_total::text, approved_total::text, actual_total::text, review_outcome from public.requisitions where id = $1",
    [id],
  );
}

async function items(id: string) {
  const r = await db.query<{
    id: string; line_number: number; review_status: string; approved_quantity: string | null; purchased_quantity: string;
    ordered_quantity: string; po_quantity: string; cancelled_quantity: string; actual_total: string;
  }>(
    `select id, line_number, review_status, approved_quantity::text, purchased_quantity::text, ordered_quantity::text,
            po_quantity::text, cancelled_quantity::text, actual_total::text
     from public.requisition_items where requisition_id = $1 order by line_number`,
    [id],
  );
  return r.rows;
}

describe("requisition submission", () => {
  it("validates, numbers sequentially and recalculates totals server-side", async () => {
    const a = await submit(db, payload(ids));
    const b = await submit(db, payload(ids));
    const year = new Date().getFullYear();
    expect(a.requisition_number).toMatch(new RegExp(`^TKT-REQ-${year}-\\d{4}$`));
    expect(Number(b.requisition_number.slice(-4))).toBe(Number(a.requisition_number.slice(-4)) + 1);
    // 3 × 19.99 = 59.97 ; 2.5 × 10.01 = 25.025 → 25.03 ; total 85.00
    expect(a.estimated_total).toBe("85.00");
    expect(a.status).toBe("submitted");
    const r = await one<{ requester_email: string; n: number; h: number }>(
      db,
      `select requester_email,
              (select count(*)::int from public.requisition_items where requisition_id = r.id) as n,
              (select count(*)::int from public.requisition_status_history where requisition_id = r.id) as h
       from public.requisitions r where id = $1`,
      [a.id],
    );
    expect(r).toEqual({ requester_email: "jordan@example.org", n: 2, h: 1 });
    const audit = await one<{ n: number }>(db, "select count(*)::int as n from public.audit_logs where action = 'requisition.submitted' and entity_id = $1", [a.id]);
    expect(audit.n).toBe(1);
    const token = await one<{ submission_count: number }>(db, "select submission_count from public.external_form_tokens where id = $1", [tokenId]);
    expect(token.submission_count).toBeGreaterThanOrEqual(2);
  });

  it("ignores any client-supplied totals", async () => {
    const r = await submit(db, payload(ids, { estimated_total: "1.00", items: [{ description: "Mic stand", quantity: "1", estimated_unit_price: "45.50", estimated_total: "0.01" }] }));
    expect(r.estimated_total).toBe("45.50");
  });

  it.each([
    [{ items: [] }, /at least one item/],
    [{ items: [{ description: "Thing", quantity: "-1", estimated_unit_price: "1" }] }, /positive number/],
    [{ items: [{ description: "Thing", quantity: "1", estimated_unit_price: "1.001" }] }, /at most 2 decimal/],
    [{ items: [{ description: "Thing", quantity: "1", estimated_unit_price: "1e3" }] }, /at most 2 decimal/],
    [{ budget_status: "no", budget_explanation: "" }, /explain the budget/],
    [{ certification_accepted: false }, /certification/],
    [{ needed_by: "2001-01-01" }, /today or a future date/],
    [{ requester_email: "not-an-email" }, /requisitions_requester_email_check/],
    [{ justification: "too short" }, /requisitions_justification_check/],
  ])("rejects invalid input %#", async (overrides, pattern) => {
    await expectError(submit(db, payload(ids, overrides)), pattern);
  });

  it("rejects a subcategory from another department", async () => {
    await expectError(submit(db, payload(ids, { subcategory_id: ids.otherSubId })), /subcategory for the selected department/);
  });

  it("enforces reimbursement-specific rules", async () => {
    const base = { request_type_id: ids.types.reimbursement };
    await expectError(submit(db, payload(ids, base)), /Actual purchase amount/);
    const withDetails = { ...base, actual_purchase_amount: "42.10", purchase_vendor: "Party Store", purchase_date: daysFromNow(-3) };
    await expectError(submit(db, payload(ids, withDetails)), /receipt upload is required/);
    await expectError(submit(db, payload(ids, withDetails), [{ path: `external/${tokenId}/missing.pdf` }]), /not found/);
    await putObject(db, `external/${tokenId}/r1.jpg`, "image/jpeg", 50_000);
    const ok = await submit(db, payload(ids, withDetails), [{ path: `external/${tokenId}/r1.jpg`, original_filename: "IMG_0001.jpg" }]);
    const receipt = await one<{ source: string; status: string; files: number }>(
      db,
      "select source, status, (select count(*)::int from public.receipt_files f where f.receipt_id = r.id) as files from public.receipts r where requisition_id = $1",
      [ok.id],
    );
    expect(receipt).toEqual({ source: "submission", status: "pending", files: 1 });
    // The same file cannot be attached twice; other prefixes are refused.
    await expectError(submit(db, payload(ids, withDetails), [{ path: `external/${tokenId}/r1.jpg` }]), /already attached/);
    await putObject(db, `requisitions/${ok.id}/x.pdf`);
    await expectError(submit(db, payload(ids, withDetails), [{ path: `requisitions/${ok.id}/x.pdf` }]), /Invalid receipt file path/);
  });

  it("rejects disallowed file types even with an allowed extension", async () => {
    await putObject(db, `external/${tokenId}/evil.pdf`, "text/html", 100);
    await expectError(
      submit(db, payload(ids, { request_type_id: ids.types.reimbursement, actual_purchase_amount: "5", purchase_vendor: "Shop", purchase_date: daysFromNow(-1) }), [{ path: `external/${tokenId}/evil.pdf` }]),
      /PDF, JPEG, PNG or HEIC/,
    );
  });

  it("enforces a request type spending limit when configured", async () => {
    await db.query("update public.request_types set max_total = 50 where key = 'petty_cash'");
    await expectError(submit(db, payload(ids, { request_type_id: ids.types.petty_cash })), /limited to 50/);
    await db.query("update public.request_types set max_total = null where key = 'petty_cash'");
  });
});

describe("finance review", () => {
  it("approves fully", async () => {
    const r = await submit(db, payload(ids));
    const out = await rpc<{ status: string; approved_total: string }>(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]);
    expect(out).toMatchObject({ status: "approved", approved_total: "85.00" });
    expect((await items(r.id)).map((i) => i.review_status)).toEqual(["approved", "approved"]);
  });

  it("partially approves with per-line decisions and reduced quantities", async () => {
    const r = await submit(db, payload(ids));
    const [l1, l2] = await items(r.id);
    await expectError(
      rpc(db, headId, "select public.review_requisition($1, 'partial', $2::jsonb) as r", [r.id, JSON.stringify([
        { item_id: l1.id, decision: "approved" },
        { item_id: l2.id, decision: "rejected" },
      ])]),
      /comment is required/,
    );
    const out = await rpc<{ status: string; approved_total: string }>(
      db, headId, "select public.review_requisition($1, 'partial', $2::jsonb) as r",
      [r.id, JSON.stringify([
        { item_id: l1.id, decision: "approved", approved_quantity: "2", approved_unit_price: "18.50" },
        { item_id: l2.id, decision: "rejected", comment: "Cups already in stock" },
      ])],
    );
    expect(out).toMatchObject({ status: "partially_approved", approved_total: "37.00" });
  });

  it("requires comments for hold and reject, and records history", async () => {
    const r = await submit(db, payload(ids));
    await expectError(rpc(db, headId, "select public.review_requisition($1, 'hold') as r", [r.id]), /comment is required/);
    await rpc(db, headId, "select public.start_requisition_review($1) as r", [r.id]);
    const held = await rpc<{ status: string }>(db, headId, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need vendor quote') as r", [r.id]);
    expect(held.status).toBe("on_hold");
    const rejected = await rpc<{ status: string }>(db, headId, "select public.review_requisition($1, 'reject', '[]'::jsonb, 'Not in budget') as r", [r.id]);
    expect(rejected.status).toBe("rejected");
    const history = await db.query<{ from_status: string | null; to_status: string; comment: string | null; changed_by: string | null }>(
      "select from_status, to_status, comment, changed_by from public.requisition_status_history where requisition_id = $1 order by created_at, to_status",
      [r.id],
    );
    expect(history.rows.map((h) => `${h.from_status ?? "∅"}→${h.to_status}`)).toEqual([
      "∅→submitted", "submitted→under_review", "under_review→on_hold", "on_hold→rejected",
    ]);
    expect(history.rows[3]).toMatchObject({ comment: "Not in budget", changed_by: headId });
    // Rejected requisitions cannot be reviewed again
    await expectError(rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]), /can be reviewed/);
  });

  it("refuses partial approval when everything is approved", async () => {
    const r = await submit(db, payload(ids));
    const [l1, l2] = await items(r.id);
    await expectError(
      rpc(db, headId, "select public.review_requisition($1, 'partial', $2::jsonb) as r", [r.id, JSON.stringify([
        { item_id: l1.id, decision: "approved" }, { item_id: l2.id, decision: "approved" },
      ])]),
      /use Approve/,
    );
  });
});

describe("purchasing: Order workflow end to end", () => {
  let reqId: string;
  let lines: Awaited<ReturnType<typeof items>>;

  it("issues a PO only for approved quantities", async () => {
    const r = await submit(db, payload(ids));
    reqId = r.id;
    await expectError(rpc(db, headId, "select public.issue_purchase_order($1) as r", [reqId]), /approved requisition/);
    await rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [reqId]);
    lines = await items(reqId);
    await expectError(
      rpc(db, headId, "select public.issue_purchase_order($1, $2::jsonb) as r", [reqId, JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "4" }])]),
      /only 3.00 remain/,
    );
    const po = await rpc<{ po_number: string; total: string; status: string }>(
      db, headId, "select public.issue_purchase_order($1, null, $2::jsonb, 'Deliver to church office') as r",
      [reqId, JSON.stringify({ name: "Coffee Co", email: "orders@coffee.example" })],
    );
    expect(po.po_number).toMatch(/^TKT-PO-\d{4}-\d{4}$/);
    expect(po.total).toBe("85.00");
    expect(po.status).toBe("po_issued");
    await expectError(rpc(db, headId, "select public.issue_purchase_order($1) as r", [reqId]), /no approved quantities left/);
  });

  it("records multiple, partial vendor orders", async () => {
    const first = await rpc<{ status: string }>(
      db, headId, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r",
      [reqId, JSON.stringify({ vendor_name: "Coffee Co", vendor_reference: "CC-1", order_date: daysFromNow(0) }),
       JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "2" }])],
    );
    expect(first.status).toBe("ordered");
    await expectError(
      rpc(db, headId, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r",
        [reqId, JSON.stringify({ vendor_name: "Coffee Co", order_date: daysFromNow(0) }),
         JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "2" }])]),
      /only 1.00 remain/,
    );
    await rpc(db, headId, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r",
      [reqId, JSON.stringify({ vendor_name: "Paper Supply", order_date: daysFromNow(0) }),
       JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "1" }, { requisition_item_id: lines[1].id, quantity: "2.5", unit_price: "9.99" }])]);
    const after = await items(reqId);
    expect(after.map((i) => i.ordered_quantity)).toEqual(["3.00", "2.50"]);
    const orders = await one<{ n: number }>(db, "select count(*)::int as n from public.vendor_orders where requisition_id = $1", [reqId]);
    expect(orders.n).toBe(2);
  });

  it("a receipt arriving does NOT mark anything purchased", async () => {
    await putObject(db, `requisitions/${reqId}/receipt-1.pdf`);
    const receiptId = await rpc<string>(db, headId, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
      [reqId, JSON.stringify([{ path: `requisitions/${reqId}/receipt-1.pdf`, original_filename: "receipt.pdf" }])]);
    expect(receiptId).toBeTruthy();
    expect((await req(reqId)).status).toBe("ordered");
    expect((await items(reqId)).every((i) => i.purchased_quantity === "0.00")).toBe(true);
  });

  it("reconciles partial purchases with price differences", async () => {
    const receipt = await one<{ id: string }>(db, "select id from public.receipts where requisition_id = $1", [reqId]);
    await expectError(
      rpc(db, headId, "select public.reconcile_receipt($1, $2::jsonb) as r",
        [receipt.id, JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "5", actual_amount: "90" }])]),
      /exceed the approved quantity/,
    );
    const out = await rpc<{ status: string; allocated_amount: string }>(
      db, headId, "select public.reconcile_receipt($1, $2::jsonb, $3::jsonb) as r",
      [receipt.id, JSON.stringify([{ requisition_item_id: lines[0].id, quantity: "2", actual_amount: "41.10" }]),
       JSON.stringify({ vendor_name: "Coffee Co", purchase_date: daysFromNow(0), reference: "INV-77" })],
    );
    expect(out).toEqual({ previous_status: "ordered", status: "partially_purchased", allocated_amount: "41.10" });
    const r = await req(reqId);
    expect(r.actual_total).toBe("41.10");
    // Reconciled receipts are final
    await expectError(rpc(db, headId, "select public.reconcile_receipt($1, '[]'::jsonb) as r", [receipt.id]), /Only pending receipts/);
  });

  it("supports multiple receipts until all approved quantities are accounted for", async () => {
    await putObject(db, `requisitions/${reqId}/receipt-2.png`, "image/png");
    const receiptId = await rpc<string>(db, headId, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
      [reqId, JSON.stringify([{ path: `requisitions/${reqId}/receipt-2.png` }])]);
    const out = await rpc<{ status: string }>(
      db, headId, "select public.reconcile_receipt($1, $2::jsonb) as r",
      [receiptId, JSON.stringify([
        { requisition_item_id: lines[0].id, quantity: "1", actual_amount: "19.99" },
        { requisition_item_id: lines[1].id, quantity: "1.5", actual_amount: "14.00" },
      ])],
    );
    expect(out.status).toBe("partially_purchased");
    // One remaining unit of line 2 will not be bought: cancel it to complete.
    const cancelled = await rpc<{ status: string }>(db, headId, "select public.cancel_item_remaining($1, '1', 'Out of stock') as r", [lines[1].id]);
    expect(cancelled.status).toBe("purchased");
    const final = await req(reqId);
    expect(final).toMatchObject({ status: "purchased", approved_total: "85.00", actual_total: "75.09" });
  });

  it("closes, then refuses further changes", async () => {
    const out = await rpc<{ status: string }>(db, headId, "select public.close_requisition($1) as r", [reqId]);
    expect(out.status).toBe("closed");
    await putObject(db, `requisitions/${reqId}/late.pdf`);
    await expectError(
      rpc(db, headId, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
        [reqId, JSON.stringify([{ path: `requisitions/${reqId}/late.pdf` }])]),
      /rejected or closed/,
    );
    const actions = await db.query<{ action: string }>(
      "select distinct action from public.audit_logs where requisition_id = $1 order by action", [reqId]);
    expect(actions.rows.map((a) => a.action)).toEqual(expect.arrayContaining([
      "requisition.submitted", "requisition.approved", "purchase_order.issued", "vendor_order.recorded",
      "receipt.uploaded", "receipt.reconciled", "requisition.purchase_completed", "requisition.closed",
      "requisition.status_changed",
    ]));
  });
});

describe("purchasing: other request types", () => {
  it("voiding the only PO returns the requisition to its review outcome", async () => {
    const r = await submit(db, payload(ids, { request_type_id: ids.types.direct_purchase }));
    await rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]);
    const po = await rpc<{ id: string }>(db, headId, "select public.issue_purchase_order($1) as r", [r.id]);
    expect((await req(r.id)).status).toBe("po_issued");
    await expectError(
      rpc(db, headId, "select public.record_vendor_order($1, $2::jsonb, '[]'::jsonb) as r",
        [r.id, JSON.stringify({ vendor_name: "X", order_date: daysFromNow(0) })]),
      /do not record vendor orders/,
    );
    const voided = await rpc<{ status: string }>(db, headId, "select public.void_purchase_order($1, 'Wrong vendor') as r", [po.id]);
    expect(voided.status).toBe("approved");
  });

  it("reimbursement: reconcile submitted receipt, then record disbursement and close", async () => {
    await putObject(db, `external/${tokenId}/reimb.pdf`);
    const r = await submit(
      db,
      payload(ids, { request_type_id: ids.types.reimbursement, actual_purchase_amount: "85.00", purchase_vendor: "Shop", purchase_date: daysFromNow(-2) }),
      [{ path: `external/${tokenId}/reimb.pdf` }],
    );
    await expectError(rpc(db, headId, "select public.issue_purchase_order($1) as r", [r.id]), /do not use Purchase Orders/);
    await rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]);
    const [l1, l2] = await items(r.id);
    const receipt = await one<{ id: string }>(db, "select id from public.receipts where requisition_id = $1", [r.id]);
    const out = await rpc<{ status: string }>(db, headId, "select public.reconcile_receipt($1, $2::jsonb) as r",
      [receipt.id, JSON.stringify([
        { requisition_item_id: l1.id, quantity: "3", actual_amount: "59.97" },
        { requisition_item_id: l2.id, quantity: "2.5", actual_amount: "25.03" },
      ])]);
    expect(out.status).toBe("purchased");
    await expectError(
      rpc(db, headId, "select public.record_disbursement($1, '90.00', 'check', current_date, '1001') as r", [r.id]),
      /cannot exceed the approved amount/,
    );
    await rpc(db, headId, "select public.record_disbursement($1, '85.00', 'check', current_date, '1001') as r", [r.id]);
    const closed = await rpc<{ status: string }>(db, headId, "select public.close_requisition($1) as r", [r.id]);
    expect(closed.status).toBe("closed");
  });

  it("closing early requires a comment and no pending receipts", async () => {
    const r = await submit(db, payload(ids, { request_type_id: ids.types.advance_check }));
    await rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]);
    await expectError(rpc(db, headId, "select public.close_requisition($1) as r", [r.id]), /comment is required/);
    await rpc(db, headId, "select public.close_requisition($1, 'Event cancelled') as r", [r.id]);
    expect((await req(r.id)).status).toBe("closed");
  });
});

describe("inbound email ingestion", () => {
  it("is idempotent and queues matched receipts for reconciliation", async () => {
    const r = await submit(db, payload(ids));
    await putObject(db, "inbound/msg-1/a.pdf");
    const email = { provider: "resend", provider_message_id: "msg-1", from: "jordan@example.org", to: ["receipts@x.org"], subject: `Re: ${r.requisition_number}` };
    const first = await as(db, "service_role", null, async () =>
      (await one<{ r: Record<string, unknown> }>(db, "select public.ingest_inbound_email($1::jsonb, $2::jsonb, $3::jsonb) as r",
        [JSON.stringify(email), JSON.stringify({ requisition_id: r.id, method: "subject" }), JSON.stringify([{ path: "inbound/msg-1/a.pdf", original_filename: "a.pdf" }])])).r);
    expect(first).toMatchObject({ duplicate: false, status: "matched", requisition_id: r.id });
    const second = await as(db, "service_role", null, async () =>
      (await one<{ r: Record<string, unknown> }>(db, "select public.ingest_inbound_email($1::jsonb, $2::jsonb, $3::jsonb) as r",
        [JSON.stringify(email), JSON.stringify({ requisition_id: r.id, method: "subject" }), JSON.stringify([{ path: "inbound/msg-1/a.pdf" }])])).r);
    expect(second).toEqual({ duplicate: true });
    const receipt = await one<{ status: string; source: string }>(db, "select status, source from public.receipts where requisition_id = $1", [r.id]);
    expect(receipt).toEqual({ status: "pending", source: "email" });
    expect((await req(r.id)).status).toBe("submitted");
  });

  it("stores unmatched emails for manual assignment", async () => {
    await putObject(db, "inbound/msg-2/b.jpg", "image/jpeg");
    const out = await as(db, "service_role", null, async () =>
      (await one<{ r: Record<string, unknown> }>(db, "select public.ingest_inbound_email($1::jsonb, '{}'::jsonb, $2::jsonb) as r",
        [JSON.stringify({ provider: "resend", provider_message_id: "msg-2", from: "someone@else.org", subject: "receipt" }),
         JSON.stringify([{ path: "inbound/msg-2/b.jpg" }])])).r);
    expect(out.status).toBe("unmatched");
    const r = await submit(db, payload(ids));
    await rpc(db, headId, "select public.assign_receipt($1, $2) as r", [out.receipt_id, r.id]);
    const receipt = await one<{ status: string }>(db, "select status from public.receipts where id = $1", [out.receipt_id]);
    expect(receipt.status).toBe("pending");
  });
});
