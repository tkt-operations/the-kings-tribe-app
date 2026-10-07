/**
 * Operational user notifications (migration 20261009000100): event generation,
 * permission-based routing, event-specific actor rules, idempotency, RLS and
 * IDOR protection, read state, safe links, Needs Attention and Realtime scope.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, daysFromNow, FORM_TOKEN, lookup, payload, putObject, rpc, submit } from "./fixtures";

const MIGRATION = "20261009000100_user_notifications.sql";

let db: Db;
let ids: Awaited<ReturnType<typeof lookup>>;
let tokenId: string;
let today: string;
const u: Record<string, string> = {};

interface Row { user_id: string; type: string; category: string; importance: string; title: string; body: string | null; link: string; requisition_id: string | null; receipt_id: string | null; visible_with: string; read_at: string | null }

async function rows(where = "true", params: unknown[] = []) {
  return (await db.query<Row>(`select user_id, type, category::text, importance::text, title, body, link, requisition_id, receipt_id, visible_with, read_at from public.user_notifications where ${where} order by created_at, user_id`, params)).rows;
}
/** Recipients (by test name) of a given event type on a requisition. */
async function recipients(type: string, requisitionId: string | null, receiptId?: string) {
  const r = await rows(requisitionId ? "type = $1 and requisition_id = $2" : "type = $1 and receipt_id = $2", [type, requisitionId ?? receiptId]);
  return r.map((x) => Object.entries(u).find(([, id]) => id === x.user_id)?.[0]).sort();
}

async function submitWithPriority(body: Record<string, unknown>) {
  return as(db, "service_role", null, async () => {
    const row = await one<{ r: { id: string; requisition_number: string } }>(
      db, "select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, $3) as r", [FORM_TOKEN, JSON.stringify(body), "fp-" + Math.random()]);
    return row.r;
  });
}
const items = (priority: "essential" | "medium") => [
  { description: "Wireless microphone", quantity: "1", estimated_unit_price: "600", priority, essential_justification: priority === "essential" ? "Required to replace failed equipment before Sunday." : undefined },
  { description: "XLR cables", quantity: "2", estimated_unit_price: "40", priority: "medium" },
];
async function lines(reqId: string) {
  return (await db.query<{ id: string }>("select id from public.requisition_items where requisition_id = $1 order by line_number", [reqId])).rows;
}
const approve = (actor: string, id: string) => rpc(db, actor, "select public.review_requisition($1, 'approve') as r", [id]);

beforeAll(async () => {
  db = await createTestDatabase();
  u.admin = await createUser(db, "admin@example.org", ["administrator"]);
  u.head = await createUser(db, "head@example.org", ["head_of_finance"]);
  u.finance = await createUser(db, "finance@example.org", ["finance_user"]);
  u.viewer = await createUser(db, "viewer@example.org", ["viewer"]);
  u.inactive = await createUser(db, "former@example.org", ["head_of_finance"]);
  await db.query("update public.profiles set is_active = false where id = $1", [u.inactive]);
  // Custom roles: routing follows permissions, not role names.
  await db.query("insert into public.roles (key, name) values ('purchaser', 'Purchaser'), ('reconciler', 'Reconciler'), ('blind_reconciler', 'Reconciler without view')");
  await db.query(`insert into public.role_permissions (role_id, permission_key)
    select r.id, p from public.roles r, unnest(array['orders.record', 'requisitions.view']) p where r.key = 'purchaser'
    union all select r.id, p from public.roles r, unnest(array['receipts.reconcile', 'requisitions.view']) p where r.key = 'reconciler'
    union all select r.id, 'receipts.reconcile' from public.roles r where r.key = 'blind_reconciler'`);
  u.purchaser = await createUser(db, "purchaser@example.org", ["purchaser"]);
  u.reconciler = await createUser(db, "reconciler@example.org", ["reconciler"]);
  u.blind = await createUser(db, "blind@example.org", ["blind_reconciler"]);
  ids = await lookup(db);
  tokenId = await createFormToken(db);
  today = (await one<{ d: string }>(db, "select private.church_today()::text as d")).d;
});

// Many submissions from one test link: keep the per-link submission limit out of the way.
beforeEach(async () => {
  await db.query("delete from public.rate_limit_events");
});

describe("requisition.submitted", () => {
  it("goes to every active user who can review (administrators included), and nobody else", async () => {
    const r = await submit(db, payload(ids));
    expect(await recipients("requisition.submitted", r.id)).toEqual(["admin", "head"]);
    const [row] = await rows("type = 'requisition.submitted' and requisition_id = $1 and user_id = $2", [r.id, u.head]);
    expect(row).toMatchObject({
      category: "requisitions", importance: "normal", title: "New requisition requires review",
      body: `${r.requisition_number} · Hospitality Team`, link: `/requisitions/${r.id}`, visible_with: "requisitions.view", read_at: null,
    });
  });

  it("is high importance with an Essential line (priorities are read at commit)", async () => {
    const r = await submitWithPriority(payload(ids, { items: items("essential") }));
    const [row] = await rows("type = 'requisition.submitted' and requisition_id = $1 and user_id = $2", [r.id, u.admin]);
    expect(row).toMatchObject({ importance: "high", title: "Essential requisition requires review", body: `${r.requisition_number} · Hospitality Team · 1 Essential item` });
  });

  it("never contains amounts, item descriptions or requester details", async () => {
    const r = await submitWithPriority(payload(ids, { items: items("essential") }));
    const text = JSON.stringify(await rows("requisition_id = $1", [r.id]));
    for (const forbidden of ["600", "40.00", "Wireless", "XLR", "Jordan", "example.org", "$"]) expect(text).not.toContain(forbidden);
  });

  it("creates no notification for the external requester (they have no account)", async () => {
    const r = await submit(db, payload(ids));
    const n = await one<{ n: number }>(db, "select count(*)::int as n from public.user_notifications un join public.profiles p on p.id = un.user_id where un.requisition_id = $1 and lower(p.email) = 'jordan@example.org'", [r.id]);
    expect(n.n).toBe(0);
  });

  it("is idempotent: replaying the same event inserts nothing", async () => {
    const r = await submit(db, payload(ids));
    const history = await one<{ id: string }>(db, "select id from public.requisition_status_history where requisition_id = $1 and to_status = 'submitted'", [r.id]);
    const before = (await rows("requisition_id = $1", [r.id])).length;
    const again = await one<{ n: number }>(db,
      "select private.notify_holders('requisitions.review', null, 'requisition.submitted', 'requisitions', 'normal', 'x', null, $1, $2, null, 'requisitions.view', $3) as n",
      [`/requisitions/${r.id}`, r.id, `status:${history.id}`]);
    expect(again.n).toBe(0);
    expect((await rows("requisition_id = $1", [r.id])).length).toBe(before);
  });

  it("demo requisitions never notify", async () => {
    await db.exec("begin");
    const r = await submit(db, payload(ids));
    await db.query("update public.requisitions set is_demo = true where id = $1", [r.id]);
    await db.exec("commit");
    expect(await rows("requisition_id = $1", [r.id])).toEqual([]);
  });
});

describe("reviewer assignment", () => {
  it("starting a review self-assigns without a notification; assigning someone else notifies only them", async () => {
    const r = await submit(db, payload(ids));
    await rpc(db, u.head, "select public.start_requisition_review($1) as r", [r.id]);
    expect(await recipients("requisition.assigned", r.id)).toEqual([]);
    await rpc(db, u.head, "select public.assign_requisition_reviewer($1, $2) as r", [r.id, u.admin]);
    expect(await recipients("requisition.assigned", r.id)).toEqual(["admin"]);
    // Assigning someone who cannot review creates nothing (but the assignment itself still works).
    await rpc(db, u.admin, "select public.assign_requisition_reviewer($1, $2) as r", [r.id, u.viewer]);
    expect(await recipients("requisition.assigned", r.id)).toEqual(["admin"]);
    // Re-assigning back later is a new event.
    await db.exec("begin");
    await rpc(db, u.admin, "select public.assign_requisition_reviewer($1, $2) as r", [r.id, u.head]);
    await db.exec("commit");
    expect(await recipients("requisition.assigned", r.id)).toEqual(["admin", "head"]);
  });
});

describe("review decisions", () => {
  it("approved (Order type) → users who can issue the PO, INCLUDING the approver", async () => {
    const r = await submit(db, payload(ids));
    await approve(u.head, r.id);
    expect(await recipients("requisition.approved", r.id)).toEqual(["admin", "head"]);
    const [row] = await rows("type = 'requisition.approved' and requisition_id = $1 and user_id = $2", [r.id, u.head]);
    expect(row).toMatchObject({ title: "Requisition approved — ready for PO", category: "purchasing", importance: "normal" });
  });

  it("partially approved → partially_approved event to the next-action holders", async () => {
    const r = await submit(db, payload(ids));
    const [a, b] = await lines(r.id);
    await rpc(db, u.head, "select public.review_requisition($1, 'partial', $2::jsonb) as r", [r.id, JSON.stringify([
      { item_id: a.id, decision: "approved" }, { item_id: b.id, decision: "rejected", comment: "Not needed" }])]);
    expect(await recipients("requisition.partially_approved", r.id)).toEqual(["admin", "head"]);
    expect((await rows("type = 'requisition.partially_approved' and requisition_id = $1", [r.id]))[0].title).toBe("Requisition partially approved — ready for PO");
  });

  it("petty cash approval → disbursements.record holders (finance category)", async () => {
    const r = await submit(db, payload(ids, { request_type_id: ids.types.petty_cash }));
    await approve(u.admin, r.id);
    const got = await rows("type = 'requisition.approved' and requisition_id = $1", [r.id]);
    expect(got.map((x) => x.user_id).sort()).toEqual([u.admin, u.head].sort());
    expect(got[0]).toMatchObject({ title: "Requisition approved — ready for disbursement", category: "finance" });
  });

  it("reimbursement approval → users who reconcile receipts (including custom roles)", async () => {
    await putObject(db, `external/${tokenId}/reimb-n.pdf`);
    const r = await submit(db, payload(ids, { request_type_id: ids.types.reimbursement, actual_purchase_amount: "85.00", purchase_vendor: "Shop", purchase_date: daysFromNow(-2) }),
      [{ path: `external/${tokenId}/reimb-n.pdf` }]);
    // The receipt sent with the submission is covered by requisition.submitted.
    expect(await recipients("receipt.received", r.id)).toEqual([]);
    await approve(u.admin, r.id);
    expect(await recipients("requisition.approved", r.id)).toEqual(["admin", "head", "reconciler"]);
  });

  it("on hold → the assigned reviewer, unless they placed the hold themselves", async () => {
    const assigned = await submit(db, payload(ids));
    await rpc(db, u.head, "select public.start_requisition_review($1) as r", [assigned.id]); // head becomes reviewer
    await rpc(db, u.admin, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need a quote') as r", [assigned.id]);
    expect(await recipients("requisition.on_hold", assigned.id)).toEqual(["head"]);

    // Reviewing self-assigns when nobody was assigned (review_requisition), so the
    // person who placed the hold now owns it: nobody else needs to be told.
    const unassigned = await submit(db, payload(ids));
    await rpc(db, u.head, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need a quote') as r", [unassigned.id]);
    expect((await one<{ a: string }>(db, "select assigned_reviewer_id as a from public.requisitions where id = $1", [unassigned.id])).a).toBe(u.head);
    expect(await recipients("requisition.on_hold", unassigned.id)).toEqual([]);

    // Defensive fallback (no assignee at all, e.g. an assignee later removed): review holders minus the actor.
    const orphan = await submit(db, payload(ids));
    await db.exec("begin");
    await rpc(db, u.head, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need a quote') as r", [orphan.id]);
    await db.query("update public.requisitions set assigned_reviewer_id = null where id = $1", [orphan.id]);
    await db.exec("commit");
    expect(await recipients("requisition.on_hold", orphan.id)).toEqual(["admin"]);

    const selfHeld = await submit(db, payload(ids));
    await rpc(db, u.head, "select public.start_requisition_review($1) as r", [selfHeld.id]);
    await rpc(db, u.head, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need a quote') as r", [selfHeld.id]);
    expect(await recipients("requisition.on_hold", selfHeld.id)).toEqual([]); // the assignee did it themselves
  });

  it("rejected → review holders minus the actor (FYI, low)", async () => {
    const r = await submit(db, payload(ids));
    await rpc(db, u.admin, "select public.review_requisition($1, 'reject', '[]'::jsonb, 'Not in budget') as r", [r.id]);
    expect(await recipients("requisition.rejected", r.id)).toEqual(["head"]);
    expect((await rows("type = 'requisition.rejected' and requisition_id = $1", [r.id]))[0].importance).toBe("low");
  });
});

describe("purchasing flow (Order type)", () => {
  let reqId: string;
  let poId: string;
  let lineIds: string[];

  beforeAll(async () => {
    const r = await submit(db, payload(ids));
    reqId = r.id;
    lineIds = (await lines(r.id)).map((l) => l.id);
    await approve(u.head, r.id);
  });

  it("PO issued (type records vendor orders) → orders.record holders INCLUDING the issuer, custom roles too", async () => {
    const po = await rpc<{ id: string }>(db, u.head, "select public.issue_purchase_order($1) as r", [reqId]);
    poId = po.id;
    expect(await recipients("purchase_order.issued", reqId)).toEqual(["admin", "head", "purchaser"]);
    expect((await rows("type = 'purchase_order.issued' and requisition_id = $1", [reqId]))[0].title).toBe("Purchase order issued — ready to order");
  });

  it("vendor order placed → reconcilers minus the actor; cancelled → order recorders minus the actor", async () => {
    const vo = await rpc<{ id: string }>(db, u.purchaser, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r", [
      reqId, JSON.stringify({ vendor_name: "Coffee Co", order_date: today }), JSON.stringify([{ requisition_item_id: lineIds[0], quantity: "1" }])]);
    expect(await recipients("vendor_order.placed", reqId)).toEqual(["admin", "head", "reconciler"]);
    await rpc(db, u.head, "select public.cancel_vendor_order($1, 'Wrong vendor') as r", [vo.id]);
    expect(await recipients("vendor_order.cancelled", reqId)).toEqual(["admin", "purchaser"]);
  });

  it("receipt uploaded → reconcilers INCLUDING the uploader", async () => {
    await putObject(db, `requisitions/${reqId}/n1.pdf`);
    const receiptId = await rpc<string>(db, u.head, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
      [reqId, JSON.stringify([{ path: `requisitions/${reqId}/n1.pdf`, original_filename: "n1.pdf" }])]);
    expect(await recipients("receipt.received", reqId)).toEqual(["admin", "head", "reconciler"]);
    const [row] = await rows("type = 'receipt.received' and user_id = $1 and requisition_id = $2", [u.head, reqId]);
    expect(row).toMatchObject({ receipt_id: receiptId, link: `/requisitions/${reqId}`, title: "Receipt ready to reconcile" });
  });

  it("fully purchased → ready to close, to review holders INCLUDING the reconciler who completed it", async () => {
    const receipt = await one<{ id: string }>(db, "select id from public.receipts where requisition_id = $1 and status = 'pending'", [reqId]);
    await rpc(db, u.head, "select public.reconcile_receipt($1, $2::jsonb) as r", [receipt.id, JSON.stringify([
      { requisition_item_id: lineIds[0], quantity: "3", actual_amount: "59.97" },
      { requisition_item_id: lineIds[1], quantity: "2.5", actual_amount: "25.03" }])]);
    expect(await recipients("requisition.purchased", reqId)).toEqual(["admin", "head"]);
    expect((await rows("type = 'requisition.purchased' and requisition_id = $1", [reqId]))[0]).toMatchObject({ title: "Requisition fully purchased — ready to close", importance: "low" });
    // partially_purchased / ordered / po_issued status moves create no separate notification.
    expect((await rows("requisition_id = $1 and type not in ('requisition.submitted','requisition.approved','purchase_order.issued','vendor_order.placed','vendor_order.cancelled','receipt.received','requisition.purchased')", [reqId]))).toEqual([]);
  });

  it("closed → review holders minus the actor", async () => {
    await rpc(db, u.admin, "select public.close_requisition($1) as r", [reqId]);
    expect(await recipients("requisition.closed", reqId)).toEqual(["head"]);
  });

  it("PO voided → PO issuers minus the actor; a Direct Purchase PO → reconcilers FYI minus the actor", async () => {
    const r = await submit(db, payload(ids));
    await approve(u.admin, r.id);
    const po = await rpc<{ id: string }>(db, u.admin, "select public.issue_purchase_order($1) as r", [r.id]);
    await rpc(db, u.admin, "select public.void_purchase_order($1, 'Wrong vendor') as r", [po.id]);
    expect(await recipients("purchase_order.voided", r.id)).toEqual(["head"]);
    // Voiding moves the status back to approved: that is NOT a new approval notification.
    expect((await rows("type = 'requisition.approved' and requisition_id = $1", [r.id])).length).toBe(2);
    void poId;

    const direct = await submit(db, payload(ids, { request_type_id: ids.types.direct_purchase }));
    await approve(u.admin, direct.id);
    await rpc(db, u.admin, "select public.issue_purchase_order($1) as r", [direct.id]);
    expect(await recipients("purchase_order.issued", direct.id)).toEqual(["head", "reconciler"]);
    expect((await rows("type = 'purchase_order.issued' and requisition_id = $1", [direct.id]))[0]).toMatchObject({ title: "Purchase order issued — awaiting receipt", importance: "low" });
  });

  it("reimbursement fully purchased → ready for reimbursement to disbursement holders", async () => {
    await putObject(db, `external/${tokenId}/reimb-p.pdf`);
    const r = await submit(db, payload(ids, { request_type_id: ids.types.reimbursement, actual_purchase_amount: "85.00", purchase_vendor: "Shop", purchase_date: daysFromNow(-2) }),
      [{ path: `external/${tokenId}/reimb-p.pdf` }]);
    await approve(u.admin, r.id);
    const [a, b] = await lines(r.id);
    const receipt = await one<{ id: string }>(db, "select id from public.receipts where requisition_id = $1", [r.id]);
    await rpc(db, u.admin, "select public.reconcile_receipt($1, $2::jsonb) as r", [receipt.id, JSON.stringify([
      { requisition_item_id: a.id, quantity: "3", actual_amount: "59.97" }, { requisition_item_id: b.id, quantity: "2.5", actual_amount: "25.03" }])]);
    const got = await rows("type = 'requisition.purchased' and requisition_id = $1", [r.id]);
    expect(got.map((x) => x.user_id).sort()).toEqual([u.admin, u.head].sort());
    expect(got[0]).toMatchObject({ title: "Purchase reconciled — ready for reimbursement", category: "finance", importance: "normal" });
  });
});

describe("receipts by email", () => {
  it("unmatched → reconcilers only, linked to /receipts, visible only while they can reconcile", async () => {
    await putObject(db, "inbound/msg-n/x.pdf");
    const out = await as(db, "service_role", null, async () =>
      (await one<{ r: { receipt_id: string } }>(db, "select public.ingest_inbound_email($1::jsonb, '{}'::jsonb, $2::jsonb) as r",
        [JSON.stringify({ provider: "resend", provider_message_id: "msg-n", from: "someone@else.org", subject: "receipt" }), JSON.stringify([{ path: "inbound/msg-n/x.pdf" }])])).r);
    // The reconciler without requisitions.view also gets it: it reveals no requisition.
    expect(await recipients("receipt.unmatched", null, out.receipt_id)).toEqual(["admin", "blind", "head", "reconciler"]);
    const [row] = await rows("type = 'receipt.unmatched' and user_id = $1", [u.head]);
    expect(row).toMatchObject({ link: "/receipts", visible_with: "receipts.reconcile", requisition_id: null, receipt_id: out.receipt_id });
    expect(row.body).not.toContain("someone@else.org");
  });

  it("matched email receipt → reconcilers who can also view requisitions", async () => {
    const r = await submit(db, payload(ids));
    await putObject(db, "inbound/msg-m/a.pdf");
    await as(db, "service_role", null, () => db.query("select public.ingest_inbound_email($1::jsonb, $2::jsonb, $3::jsonb)",
      [JSON.stringify({ provider: "resend", provider_message_id: "msg-m", from: "jordan@example.org", subject: `Re: ${r.requisition_number}` }),
       JSON.stringify({ requisition_id: r.id, method: "subject" }), JSON.stringify([{ path: "inbound/msg-m/a.pdf" }])]));
    expect(await recipients("receipt.received", r.id)).toEqual(["admin", "head", "reconciler"]);
  });
});

describe("inbox security", () => {
  let reqId: string;
  let headRowId: string;
  let adminRowId: string;

  beforeEach(async () => {
    const r = await submit(db, payload(ids));
    reqId = r.id;
    headRowId = (await one<{ id: string }>(db, "select id from public.user_notifications where requisition_id = $1 and user_id = $2", [reqId, u.head])).id;
    adminRowId = (await one<{ id: string }>(db, "select id from public.user_notifications where requisition_id = $1 and user_id = $2", [reqId, u.admin])).id;
  });

  const asUser = <T,>(id: string | null, fn: () => Promise<T>) => as(db, id ? "authenticated" : "anon", id, fn);

  it("a user reads only their own rows", async () => {
    const seen = await asUser(u.head, () => db.query<{ user_id: string }>("select user_id from public.user_notifications"));
    expect(seen.rows.length).toBeGreaterThan(0);
    expect(seen.rows.every((r) => r.user_id === u.head)).toBe(true);
    const guess = await asUser(u.head, () => db.query("select * from public.user_notifications where id = $1", [adminRowId]));
    expect(guess.rows).toEqual([]);
    const viewer = await asUser(u.viewer, () => db.query("select * from public.user_notifications"));
    expect(viewer.rows).toEqual([]);
  });

  it("anonymous users have no access at all", async () => {
    await expectError(asUser(null, () => db.query("select * from public.user_notifications")), /permission denied/);
    await expectError(asUser(null, () => db.query("select public.unread_notification_count()")), /permission denied/);
    await expectError(asUser(null, () => db.query("select public.mark_all_notifications_read()")), /permission denied/);
    await expectError(asUser(null, () => db.query("select public.my_needs_attention()")), /permission denied/);
  });

  it("clients cannot create, edit or delete notifications directly", async () => {
    await expectError(asUser(u.head, () => db.query(
      "insert into public.user_notifications (user_id, type, category, title, link, visible_with, event_key) values ($1, 'requisition.submitted', 'requisitions', 'Fake', '/dashboard', 'dashboard.view', 'fake')", [u.head])), /permission denied/);
    await expectError(asUser(u.head, () => db.query("update public.user_notifications set read_at = now(), title = 'x' where id = $1", [headRowId])), /permission denied/);
    await expectError(asUser(u.head, () => db.query("delete from public.user_notifications where id = $1", [headRowId])), /permission denied/);
    await expectError(asUser(u.head, () => db.query("select private.notify_holders('requisitions.review', null, 'a.b', 'system', 'high', 't', null, '/dashboard', null, null, 'dashboard.view', 'k')")), /permission denied/);
  });

  it("mark one read: own rows only (guessing another user's id changes nothing)", async () => {
    const other = await asUser(u.head, async () => (await one<{ r: boolean }>(db, "select public.mark_notification_read($1) as r", [adminRowId])).r);
    expect(other).toBe(false);
    expect((await one<{ read_at: string | null }>(db, "select read_at from public.user_notifications where id = $1", [adminRowId])).read_at).toBeNull();
    const own = await asUser(u.head, async () => (await one<{ r: boolean }>(db, "select public.mark_notification_read($1) as r", [headRowId])).r);
    expect(own).toBe(true);
    const again = await asUser(u.head, async () => (await one<{ r: boolean }>(db, "select public.mark_notification_read($1) as r", [headRowId])).r);
    expect(again).toBe(false); // already read
  });

  it("unread count and mark all read affect only the signed-in user", async () => {
    const count = (id: string) => asUser(id, async () => (await one<{ n: number }>(db, "select public.unread_notification_count() as n")).n);
    const adminBefore = await count(u.admin);
    expect(await count(u.head)).toBeGreaterThan(0);
    const changed = await asUser(u.head, async () => (await one<{ n: number }>(db, "select public.mark_all_notifications_read() as n")).n);
    expect(changed).toBeGreaterThan(0);
    expect(await count(u.head)).toBe(0);
    expect(await count(u.admin)).toBe(adminBefore);
  });

  it("losing requisitions.view hides requisition rows (no side channel), and restoring it shows them again", async () => {
    const purchaserRow = await submit(db, payload(ids)).then(async (r) => {
      await approve(u.admin, r.id);
      await rpc(db, u.admin, "select public.issue_purchase_order($1) as r", [r.id]);
      return one<{ id: string }>(db, "select id from public.user_notifications where requisition_id = $1 and user_id = $2", [r.id, u.purchaser]);
    });
    // Revoke: the purchaser role loses requisitions.view.
    await db.query("delete from public.role_permissions where role_id = (select id from public.roles where key = 'purchaser') and permission_key = 'requisitions.view'");
    const hidden = await asUser(u.purchaser, () => db.query("select * from public.user_notifications where id = $1", [purchaserRow.id]));
    expect(hidden.rows).toEqual([]);
    expect(await asUser(u.purchaser, async () => (await one<{ n: number }>(db, "select public.unread_notification_count() as n")).n)).toBe(0);
    expect(await asUser(u.purchaser, async () => (await one<{ r: boolean }>(db, "select public.mark_notification_read($1) as r", [purchaserRow.id])).r)).toBe(false);
    await db.query("insert into public.role_permissions (role_id, permission_key) select id, 'requisitions.view' from public.roles where key = 'purchaser'");
    const back = await asUser(u.purchaser, () => db.query("select * from public.user_notifications where id = $1", [purchaserRow.id]));
    expect(back.rows).toHaveLength(1);
  });

  it("deactivated users see nothing and receive nothing new", async () => {
    const r = await submit(db, payload(ids));
    expect(await recipients("requisition.submitted", r.id)).not.toContain("inactive");
    const seen = await asUser(u.inactive, () => db.query("select * from public.user_notifications"));
    expect(seen.rows).toEqual([]);
  });
});

describe("safe links", () => {
  it.each([
    "https://evil.example.com/", "//evil.example.com", "/requisitions/../admin", "/requisitions/not-a-uuid",
    "/requisitions/00000000-0000-0000-0000-000000000000/edit", "/admin/users", "javascript:alert(1)", "/receipts?next=//evil", "",
  ])("rejects %j", async (link) => {
    await expectError(db.query(
      "insert into public.user_notifications (user_id, type, category, title, link, visible_with, event_key) values ($1, 'a.b', 'system', 't', $2, 'dashboard.view', $3)",
      [u.head, link, `link-${Math.random()}`]), /user_notifications_link_check/);
  });

  it("accepts only the fixed application routes", async () => {
    for (const link of ["/requisitions/0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b", "/receipts", "/dashboard", "/notifications"]) {
      await db.query("insert into public.user_notifications (user_id, type, category, title, link, visible_with, event_key) values ($1, 'a.b', 'system', 't', $2, 'dashboard.view', $3)",
        [u.viewer, link, `ok-${Math.random()}`]);
    }
    await db.query("delete from public.user_notifications where user_id = $1 and type = 'a.b'", [u.viewer]);
  });
});

describe("Needs Attention", () => {
  let att: Db;
  const a: Record<string, string> = {};
  let attIds: Awaited<ReturnType<typeof lookup>>;
  let attToken: string;
  const needs = (id: string) => as(att, "authenticated", id, async () => (await one<{ r: Record<string, Record<string, number | string | null>> }>(att, "select public.my_needs_attention() as r")).r);
  const cardIds = (id: string, card: string) => as(att, "authenticated", id, async () => (await att.query<{ id: string }>("select public.needs_attention_requisition_ids($1) as id", [card])).rows.map((r) => r.id).sort());
  const sub = async (over: Record<string, unknown> = {}, files: unknown[] = []) =>
    as(att, "service_role", null, async () => (await one<{ r: { id: string } }>(att, "select public.submit_requisition($1, $2::jsonb, $3::jsonb, $4) as r",
      [FORM_TOKEN, JSON.stringify(payload(attIds, over)), JSON.stringify(files), "fp-" + Math.random()])).r);
  const attRpc = <T,>(id: string, sql: string, params: unknown[] = []) => as(att, "authenticated", id, async () => (await one<{ r: T }>(att, sql, params)).r);
  const states: Record<string, string> = {};

  beforeAll(async () => {
    att = await createTestDatabase();
    a.admin = await createUser(att, "admin@example.org", ["administrator"]);
    a.head = await createUser(att, "head@example.org", ["head_of_finance"]);
    a.viewer = await createUser(att, "viewer@example.org", ["viewer"]);
    await att.query("insert into public.roles (key, name) values ('purchaser', 'Purchaser')");
    await att.query("insert into public.role_permissions (role_id, permission_key) select r.id, p from public.roles r, unnest(array['orders.record', 'requisitions.view']) p where r.key = 'purchaser'");
    a.purchaser = await createUser(att, "purchaser@example.org", ["purchaser"]);
    attIds = await lookup(att);
    attToken = await createFormToken(att);
    const day = (await one<{ d: string }>(att, "select private.church_today()::text as d")).d;

    states.submitted = (await sub()).id;
    states.essentialMine = (await sub()).id;
    await attRpc(a.head, "select public.set_requisition_item_priority((select id from public.requisition_items where requisition_id = $1 and line_number = 1), 'essential', 'Needed before Sunday service.') as r", [states.essentialMine]);
    await attRpc(a.head, "select public.start_requisition_review($1) as r", [states.essentialMine]);
    states.onHold = (await sub()).id;
    await attRpc(a.head, "select public.review_requisition($1, 'hold', '[]'::jsonb, 'Need a quote') as r", [states.onHold]);
    states.readyForPo = (await sub()).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.readyForPo]);
    states.readyToOrder = (await sub()).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.readyToOrder]);
    await attRpc(a.head, "select public.issue_purchase_order($1) as r", [states.readyToOrder]);
    states.ordered = (await sub()).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.ordered]);
    await attRpc(a.head, "select public.issue_purchase_order($1) as r", [states.ordered]);
    const orderedLine = await one<{ id: string }>(att, "select id from public.requisition_items where requisition_id = $1 and line_number = 1", [states.ordered]);
    await attRpc(a.head, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r", [states.ordered, JSON.stringify({ vendor_name: "Co", order_date: day }), JSON.stringify([{ requisition_item_id: orderedLine.id, quantity: "3" }])]);
    states.directAwaiting = (await sub({ request_type_id: attIds.types.direct_purchase })).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.directAwaiting]);
    await attRpc(a.head, "select public.issue_purchase_order($1) as r", [states.directAwaiting]);
    states.pettyCash = (await sub({ request_type_id: attIds.types.petty_cash })).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.pettyCash]);
    states.pettyPaid = (await sub({ request_type_id: attIds.types.petty_cash })).id;
    await attRpc(a.head, "select public.review_requisition($1, 'approve') as r", [states.pettyPaid]);
    await attRpc(a.head, "select public.record_disbursement($1, '10.00', 'cash', current_date, null) as r", [states.pettyPaid]);
    // A pending receipt on an approved order (to reconcile), and one still awaiting approval (not yet reconcilable).
    await putObject(att, `requisitions/${states.readyForPo}/r.pdf`);
    await attRpc(a.head, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r", [states.readyForPo, JSON.stringify([{ path: `requisitions/${states.readyForPo}/r.pdf` }])]);
    await putObject(att, `requisitions/${states.submitted}/early.pdf`);
    await attRpc(a.head, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r", [states.submitted, JSON.stringify([{ path: `requisitions/${states.submitted}/early.pdf` }])]);
    await putObject(att, "inbound/att-1/u.pdf");
    await as(att, "service_role", null, () => att.query("select public.ingest_inbound_email($1::jsonb, '{}'::jsonb, $2::jsonb)",
      [JSON.stringify({ provider: "resend", provider_message_id: "att-1", from: "x@y.org", subject: "r" }), JSON.stringify([{ path: "inbound/att-1/u.pdf" }])]));
    void attToken;
  });

  it("counts each card from live workflow state, mirroring the workflow functions", async () => {
    const n = await needs(a.head);
    expect(n.awaiting_review).toMatchObject({ count: 2, essential: 1, assigned_to_me: 1 });
    expect(n.on_hold).toEqual({ count: 1 });
    expect(n.ready_for_po).toEqual({ count: 1 });
    expect(n.ready_to_order).toEqual({ count: 1 });
    // ordered Order + Direct Purchase with an issued PO + petty cash already paid out.
    expect(n.awaiting_receipts).toEqual({ count: 3 });
    expect(n.ready_for_disbursement).toEqual({ count: 1 });
    expect(n.receipts_to_reconcile).toEqual({ count: 1, unmatched: 1 });
    expect(await cardIds(a.head, "ready_to_order")).toEqual([states.readyToOrder]);
    expect(await cardIds(a.head, "awaiting_receipts")).toEqual([states.ordered, states.directAwaiting, states.pettyPaid].sort());
    expect(await cardIds(a.head, "ready_for_disbursement")).toEqual([states.pettyCash]);
  });

  it("shows only the cards the user may act on", async () => {
    expect(await needs(a.viewer)).toEqual({});
    expect(Object.keys(await needs(a.purchaser))).toEqual(["ready_to_order"]);
    expect(await cardIds(a.purchaser, "ready_for_po")).toEqual([]); // not their card
    expect(await cardIds(a.viewer, "awaiting_review")).toEqual([]);
    expect(await cardIds(a.head, "not_a_card")).toEqual([]);
    expect(Object.keys(await needs(a.admin)).sort()).toEqual(
      ["awaiting_receipts", "awaiting_review", "on_hold", "ready_for_disbursement", "ready_for_po", "ready_to_order", "receipts_to_reconcile"]);
  });

  it("creates no notification records", async () => {
    const before = await one<{ n: number }>(att, "select count(*)::int as n from public.user_notifications");
    await needs(a.head);
    await cardIds(a.head, "awaiting_review");
    expect((await one<{ n: number }>(att, "select count(*)::int as n from public.user_notifications")).n).toBe(before.n);
  });
});

describe("existing email infrastructure and other features are untouched", () => {
  it("does not write to the email log, delivery events or requester preferences", async () => {
    const before = await one<{ n: number; e: number }>(db, "select (select count(*) from public.notifications)::int as n, (select count(*) from public.notification_events)::int as e");
    const r = await submit(db, payload(ids));
    await approve(u.admin, r.id);
    const after = await one<{ n: number; e: number }>(db, "select (select count(*) from public.notifications)::int as n, (select count(*) from public.notification_events)::int as e");
    expect(after).toEqual(before);
    const pref = await one<{ email: string }>(db, "select email from public.notification_preferences where requisition_id = $1", [r.id]);
    expect(pref.email).toBe("jordan@example.org");
  });

  it("Product Auto-Fill submissions still work and notify reviewers", async () => {
    const r = await as(db, "service_role", null, async () => (await one<{ r: { id: string } }>(db,
      "select public.submit_requisition_with_product($1, $2::jsonb, '[]'::jsonb, null) as r",
      [FORM_TOKEN, JSON.stringify(payload(ids, { items: [{ description: "Chair", quantity: "1", estimated_unit_price: "10", priority: "medium", requested_sku: "123", lookup: { status: "none" } }] }))])).r);
    expect(await recipients("requisition.submitted", r.id)).toEqual(["admin", "head"]);
    expect((await one<{ s: string }>(db, "select requested_sku as s from public.requisition_items where requisition_id = $1", [r.id])).s).toBe("123");
  });
});

describe("Realtime publication", () => {
  it("publishes only user_notifications when the Supabase publication exists", async () => {
    const fresh = await createTestDatabase({ before: MIGRATION });
    await fresh.exec("create publication supabase_realtime");
    await applyMigrationsFrom(fresh, MIGRATION);
    const tables = await fresh.query<{ tablename: string }>("select tablename from pg_publication_tables where pubname = 'supabase_realtime'");
    expect(tables.rows).toEqual([{ tablename: "user_notifications" }]);
  });

  it("migrates cleanly where the publication does not exist", async () => {
    const fresh = await createTestDatabase();
    const pub = await fresh.query("select 1 from pg_publication where pubname = 'supabase_realtime'");
    expect(pub.rows).toEqual([]);
  });
});
