/**
 * Requisition amendments, Phase 1 (migration 20261014000100): staff amend
 * submitted / under-review / on-hold requisitions through amend_requisition
 * only. Lines keep their ids, are never deleted, and every change is recorded
 * (append-only) with the actor, reason, old and new values.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, lookup, payload, rpc, submit } from "./fixtures";

const MIGRATION = "20261014000100_requisition_amendments.sql";
const REASON = "Requester called to correct the order.";

let db: Db;
let adminId: string;
let headId: string;
let financeId: string;
let amendNoViewId: string;
let reportingId: string;
let viewerId: string;
let ids: Awaited<ReturnType<typeof lookup>>;

type Line = { id: string; line_number: number; description: string; quantity: string; estimated_unit_price: string; estimated_total: string;
  review_status: string; review_comment: string | null; added_in_revision: number; last_changed_revision: number | null;
  removed_at: string | null; removed_reason: string | null; priority: string };

const lines = async (reqId: string) => (await db.query<Line>(
  `select id, line_number, description, quantity::text, estimated_unit_price::text, estimated_total::text, review_status::text,
          review_comment, added_in_revision, last_changed_revision, removed_at::text, removed_reason, priority::text
     from public.requisition_items where requisition_id = $1 order by line_number`, [reqId])).rows;
const req = (reqId: string) => one<{ status: string; current_revision: number; amended_at: string | null; estimated_total: string; amendment_review_required: boolean }>(
  db, "select status::text, current_revision, amended_at::text, estimated_total::text, amendment_review_required from public.requisitions where id = $1", [reqId]);
const amend = (userId: string, reqId: string, changes: unknown[], reason = REASON) =>
  rpc<{ revision: number; status: string; estimated_total: string; estimated_total_before: string; lines_added: number; lines_updated: number; lines_removed: number }>(
    db, userId, "select public.amend_requisition($1, $2, $3::jsonb) as r", [reqId, reason, JSON.stringify(changes)]);
const newRequisition = async () => (await submit(db, payload(ids))).id;

beforeAll(async () => {
  db = await createTestDatabase();
  adminId = await createUser(db, "admin@example.org", ["administrator"], "Avery Admin");
  headId = await createUser(db, "head@example.org", ["head_of_finance"], "Harper Head");
  financeId = await createUser(db, "finance@example.org", ["finance_user"], "Finley Finance");
  reportingId = await createUser(db, "reporting@example.org", ["reporting_user"]);
  viewerId = await createUser(db, "viewer@example.org", ["viewer"]);
  // Finance User stays exactly as seeded. Viewer and Reporting User get
  // requisitions.view here, so their refusal is about requisitions.amend itself.
  await db.query(
    `insert into public.role_permissions (role_id, permission_key)
     select id, 'requisitions.view' from public.roles where key in ('viewer', 'reporting_user') on conflict do nothing`);
  // A custom role holding requisitions.amend but not requisitions.view.
  await db.query("insert into public.roles (key, name, is_system) values ('amend_only', 'Amend only', false)");
  await db.query("insert into public.role_permissions (role_id, permission_key) select id, 'requisitions.amend' from public.roles where key = 'amend_only'");
  amendNoViewId = await createUser(db, "amend-only@example.org", ["amend_only"]);
  ids = await lookup(db);
  await createFormToken(db);
});

describe("permission and grants", () => {
  it("requisitions.amend exists and is granted to Administrator and Head of Finance only", async () => {
    const r = await db.query<{ key: string }>(
      `select ro.key from public.role_permissions rp join public.roles ro on ro.id = rp.role_id
        where rp.permission_key = 'requisitions.amend' and ro.is_system order by ro.key`);
    expect(r.rows.map((x) => x.key)).toEqual(["administrator", "head_of_finance"]);
  });

  it("Finance User keeps exactly its existing permissions (no requisitions.amend, no requisitions.view)", async () => {
    const r = await db.query<{ permission_key: string }>(
      `select rp.permission_key from public.role_permissions rp join public.roles ro on ro.id = rp.role_id
        where ro.key = 'finance_user' order by 1`);
    expect(r.rows.map((x) => x.permission_key)).toEqual(["dashboard.view", "finance.enter", "finance.view"]);
  });

  it("the migration adds requisitions.amend to Administrator and Head of Finance and changes no other permission", async () => {
    const fresh = await createTestDatabase({ before: MIGRATION });
    const grants = async () => (await fresh.query<{ role: string; permission_key: string }>(
      `select ro.key as role, rp.permission_key from public.role_permissions rp join public.roles ro on ro.id = rp.role_id order by 1, 2`)).rows
      .map((x) => `${x.role}:${x.permission_key}`);
    const before = await grants();
    await applyMigrationsFrom(fresh, MIGRATION);
    const after = await grants();
    expect(after.filter((g) => !before.includes(g))).toEqual(["administrator:requisitions.amend", "head_of_finance:requisitions.amend"]);
    expect(before.filter((g) => !after.includes(g))).toEqual([]);
    await fresh.close();
  });

  it("Administrator and Head of Finance may amend", async () => {
    for (const user of [adminId, headId]) {
      const id = await newRequisition();
      const out = await amend(user, id, [{ op: "add", fields: { description: "Napkins", quantity: "1", estimated_unit_price: "4", priority: "low" } }]);
      expect(out.revision).toBe(2);
    }
  });

  it("Finance User, Reporting User and Viewer may not (the last two even with requisitions.view)", async () => {
    const id = await newRequisition();
    for (const user of [financeId, reportingId, viewerId]) {
      await expectError(amend(user, id, [{ op: "add", fields: { description: "Napkins", quantity: "1", estimated_unit_price: "4", priority: "low" } }]),
        /permission denied: requisitions\.amend/);
    }
    expect((await req(id)).current_revision).toBe(1);
  });

  it("amend also requires requisitions.view (a role that cannot see requisitions cannot amend them)", async () => {
    const id = await newRequisition();
    await expectError(amend(amendNoViewId, id, [{ op: "add", fields: { description: "Napkins", quantity: "1", estimated_unit_price: "4", priority: "low" } }]),
      /permission denied: requisitions\.view/);
  });

  it("the public cannot call it, and no one can write the new tables directly", async () => {
    const id = await newRequisition();
    await expectError(as(db, "anon", null, () => db.query("select public.amend_requisition($1, $2, '[]'::jsonb)", [id, REASON])), /permission denied/);
    await expectError(as(db, "authenticated", adminId, () =>
      db.query("insert into public.requisition_amendments (requisition_id, revision_number, reason, status_at_amendment, estimated_total_before, estimated_total_after) values ($1, 2, $2, 'submitted', 0, 0)", [id, REASON])),
      /permission denied/);
    await expectError(as(db, "authenticated", adminId, () => db.query("update public.requisition_items set description = 'x' where requisition_id = $1", [id])),
      /permission denied/);
  });
});

describe("the snapshot guard remains the default protection", () => {
  it("rejects direct edits to submitted content, even by the database owner", async () => {
    const id = await newRequisition();
    await expectError(db.query("update public.requisition_items set quantity = 9 where requisition_id = $1", [id]), /The submitted line item cannot be changed/);
    await expectError(db.query("update public.requisition_items set removed_at = now() where requisition_id = $1", [id]), /The submitted line item cannot be changed/);
    await expectError(db.query("update public.requisition_items set added_in_revision = 2 where requisition_id = $1", [id]), /The submitted line item cannot be changed/);
  });

  it("rejects adding a line outside an amendment", async () => {
    const id = await newRequisition();
    await expectError(db.query(
      `insert into public.requisition_items (requisition_id, line_number, description, quantity, estimated_unit_price, estimated_total, added_in_revision)
       values ($1, 9, 'Sneaky', 1, 1, 1, 2)`, [id]), /only be added to a submitted requisition by an amendment/);
  });

  it("the relaxation does not outlive the amendment's transaction", async () => {
    const id = await newRequisition();
    await amend(headId, id, [{ op: "add", fields: { description: "Stirrers", quantity: "1", estimated_unit_price: "2", priority: "low" } }]);
    await expectError(db.query("update public.requisition_items set quantity = 9 where requisition_id = $1", [id]), /cannot be changed/);
  });
});

describe("amending", () => {
  it("updates a line in place: same id, field-level history, new totals, revision 2", async () => {
    const id = await newRequisition();
    const [l1, l2] = await lines(id);
    const out = await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "5", description: "Coffee beans (dark roast)" } }]);
    expect(out).toMatchObject({ revision: 2, status: "submitted", lines_updated: 1, estimated_total_before: "85.00", estimated_total: "124.98" });
    const after = await lines(id);
    expect(after[0]).toMatchObject({ id: l1.id, line_number: 1, description: "Coffee beans (dark roast)", quantity: "5.00",
      estimated_total: "99.95", added_in_revision: 1, last_changed_revision: 2, removed_at: null });
    expect(after[1]).toMatchObject({ id: l2.id, last_changed_revision: null });
    const r = await req(id);
    expect(r).toMatchObject({ current_revision: 2, estimated_total: "124.98", amendment_review_required: false });
    expect(r.amended_at).not.toBeNull();

    const changes = await db.query<{ field: string; change_type: string; old_value: unknown; new_value: unknown; line_number: number }>(
      "select field, change_type, old_value, new_value, line_number from public.requisition_item_changes where requisition_id = $1 order by field", [id]);
    expect(changes.rows).toEqual([
      { field: "description", change_type: "updated", old_value: "Coffee beans", new_value: "Coffee beans (dark roast)", line_number: 1 },
      { field: "quantity", change_type: "updated", old_value: 3, new_value: 5, line_number: 1 },
    ]);
    const a = await one<{ revision_number: number; actor_id: string; reason: string; status_at_amendment: string; estimated_total_before: string; estimated_total_after: string }>(
      db, "select revision_number, actor_id, reason, status_at_amendment::text, estimated_total_before::text, estimated_total_after::text from public.requisition_amendments where requisition_id = $1", [id]);
    expect(a).toEqual({ revision_number: 2, actor_id: headId, reason: REASON, status_at_amendment: "submitted", estimated_total_before: "85.00", estimated_total_after: "124.98" });
  });

  it("adds a line with the next line number and records it as added in this revision", async () => {
    const id = await newRequisition();
    await amend(headId, id, [{ op: "add", fields: { description: "Sugar sachets", quantity: "2", estimated_unit_price: "3.50", priority: "essential",
      essential_justification: "The welcome table runs out every Sunday." } }]);
    const after = await lines(id);
    expect(after).toHaveLength(3);
    expect(after[2]).toMatchObject({ line_number: 3, description: "Sugar sachets", estimated_total: "7.00", added_in_revision: 2, review_status: "pending", priority: "essential" });
    expect((await req(id)).estimated_total).toBe("92.00");
    const c = await one<{ change_type: string; field: string | null; new_value: { description: string } }>(
      db, "select change_type, field, new_value from public.requisition_item_changes where requisition_item_id = $1", [after[2].id]);
    expect(c).toMatchObject({ change_type: "added", field: null, new_value: { description: "Sugar sachets" } });
  });

  it("removes a line logically: the row stays, with its reason, and leaves the current total", async () => {
    const id = await newRequisition();
    const [, l2] = await lines(id);
    await amend(headId, id, [{ op: "remove", item_id: l2.id, reason: "Cups were already in stock." }]);
    const after = await lines(id);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ id: l2.id, removed_reason: "Cups were already in stock.", last_changed_revision: 2 });
    expect(after[1].removed_at).not.toBeNull();
    expect((await req(id)).estimated_total).toBe("59.97");
    // A removed line can never change again, and cannot be amended or removed twice.
    await expectError(amend(headId, id, [{ op: "update", item_id: l2.id, fields: { quantity: "1" } }]), /already been removed/);
    await expectError(db.query("update public.requisition_items set review_comment = 'x' where id = $1", [l2.id]), /removed line item cannot be changed/);
  });

  it("uses the amendment reason when a removal gives none", async () => {
    const id = await newRequisition();
    const [, l2] = await lines(id);
    await amend(headId, id, [{ op: "remove", item_id: l2.id }]);
    expect((await lines(id))[1].removed_reason).toBe(REASON);
  });

  it("keeps line numbers unique: added lines never reuse a removed line's number", async () => {
    const id = await newRequisition();
    const [, l2] = await lines(id);
    await amend(headId, id, [{ op: "remove", item_id: l2.id }]);
    await amend(headId, id, [{ op: "add", fields: { description: "Lids", quantity: "1", estimated_unit_price: "6", priority: "medium" } }]);
    expect((await lines(id)).map((l) => l.line_number)).toEqual([1, 2, 3]);
  });

  it("revisions are sequential, and a duplicate revision number is impossible", async () => {
    const id = await newRequisition();
    const [l1] = await lines(id);
    expect((await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }])).revision).toBe(2);
    expect((await amend(adminId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "6" } }])).revision).toBe(3);
    expect((await db.query<{ revision_number: number }>("select revision_number from public.requisition_amendments where requisition_id = $1 order by 1", [id])).rows
      .map((r) => r.revision_number)).toEqual([2, 3]);
    await expectError(db.query(
      "insert into public.requisition_amendments (requisition_id, revision_number, reason, status_at_amendment, estimated_total_before, estimated_total_after) values ($1, 3, $2, 'submitted', 0, 0)",
      [id, REASON]), /duplicate key/);
    // The row lock serialises amendments (a second session waits for the first to commit).
    const src = await one<{ src: string }>(db, "select prosrc as src from pg_proc where proname = 'amend_requisition'");
    expect(src.src).toMatch(/from public\.requisitions where id = p_requisition_id for update/);
  });

  it("is atomic: one invalid change leaves nothing behind", async () => {
    const id = await newRequisition();
    const [l1] = await lines(id);
    await expectError(amend(headId, id, [
      { op: "update", item_id: l1.id, fields: { quantity: "7" } },
      { op: "add", fields: { description: "Bad", quantity: "-1", estimated_unit_price: "1", priority: "low" } },
    ]), /quantity must be a positive number/);
    expect((await lines(id))[0].quantity).toBe("3.00");
    expect(await req(id)).toMatchObject({ current_revision: 1, amended_at: null });
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.requisition_amendments where requisition_id = $1", [id])).n).toBe(0);
  });

  it("validates like a submission and refuses empty or contradictory amendments", async () => {
    const id = await newRequisition();
    const [l1, l2] = await lines(id);
    await expectError(amend(headId, id, [{ op: "add", fields: { description: "X", quantity: "1", estimated_unit_price: "1", priority: "low" } }], "short"), /at least 10 characters/);
    await expectError(amend(headId, id, []), /at least one change/);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "3" } }]), /nothing was changed/);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }, { op: "remove", item_id: l1.id }]), /more than once/);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { vendor_url: "ftp://x" } }]), /must start with http/);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { priority: "essential" } }]), /explain why this item is essential/);
    await expectError(amend(headId, id, [{ op: "add", fields: { description: "No price", quantity: "1", priority: "low" } }]), /required/);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { review_status: "approved" } }]), /unknown field/);
    await expectError(amend(headId, id, [{ op: "remove", item_id: l1.id }, { op: "remove", item_id: l2.id }]), /keep at least one line item/);
    await expectError(amend(headId, id, [{ op: "teleport" }]), /unknown change type/);
    expect((await req(id)).current_revision).toBe(1);
  });

  it("will not change a line that belongs to another requisition", async () => {
    const a = await newRequisition();
    const b = await newRequisition();
    const [lb] = await lines(b);
    await expectError(amend(headId, a, [{ op: "update", item_id: lb.id, fields: { quantity: "9" } }]), /line item not found/);
  });
});

describe("statuses", () => {
  it("allows submitted, under review and on hold", async () => {
    const id = await newRequisition();
    await rpc(db, headId, "select public.start_requisition_review($1) as r", [id]);
    expect((await req(id)).status).toBe("under_review");
    const [l1] = await lines(id);
    expect((await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }])).status).toBe("under_review");
  });

  it("on hold: changed lines return to pending (earlier decision kept) and the requisition goes back to review", async () => {
    const id = await newRequisition();
    const [l1, l2] = await lines(id);
    await rpc(db, headId, "select public.review_requisition($1, 'hold', $2::jsonb, 'Need a cheaper option') as r",
      [id, JSON.stringify([{ item_id: l1.id, comment: "Find a cheaper roaster" }])]);
    expect((await lines(id))[0]).toMatchObject({ review_status: "held", review_comment: "Find a cheaper roaster" });
    const out = await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { estimated_unit_price: "15.00" } }]);
    expect(out.status).toBe("under_review");
    const after = await lines(id);
    expect(after[0]).toMatchObject({ review_status: "pending", review_comment: null });
    expect(after[1]).toMatchObject({ id: l2.id, review_status: "pending" });
    const c = await one<{ previous_review: { review_status: string; review_comment: string } }>(
      db, "select previous_review from public.requisition_item_changes where requisition_item_id = $1", [l1.id]);
    expect(c.previous_review).toMatchObject({ review_status: "held", review_comment: "Find a cheaper roaster" });
    const h = await one<{ from_status: string; to_status: string; comment: string }>(db,
      "select from_status::text, to_status::text, comment from public.requisition_status_history where requisition_id = $1 order by created_at desc, to_status desc limit 1", [id]);
    expect(h).toEqual({ from_status: "on_hold", to_status: "under_review", comment: "Amended (revision 2)" });
  });

  it.each(["approve", "reject"])("rejects amendments after %s (Phase 1)", async (decision) => {
    const id = await newRequisition();
    await rpc(db, headId, "select public.review_requisition($1, $2, '[]'::jsonb, 'Decided after review.') as r", [id, decision]);
    const [l1] = await lines(id);
    await expectError(amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }]),
      /Only submitted, under-review or on-hold requisitions can be amended/);
  });
});

describe("review and summaries ignore removed lines", () => {
  it("Approve decides only current lines; the removed line keeps no decision", async () => {
    const id = await newRequisition();
    const [, l2] = await lines(id);
    await amend(headId, id, [{ op: "remove", item_id: l2.id }]);
    const out = await rpc<{ status: string; approved_total: string }>(db, headId, "select public.review_requisition($1, 'approve') as r", [id]);
    expect(out).toEqual({ previous_status: "submitted", status: "approved", approved_total: "59.97" });
    expect((await lines(id))[1]).toMatchObject({ review_status: "pending" });
  });

  it("priority summaries and the priority editor skip removed lines", async () => {
    const id = await newRequisition();
    await amend(headId, id, [{ op: "add", fields: { description: "Urn repair", quantity: "1", estimated_unit_price: "40", priority: "essential",
      essential_justification: "The only urn is broken before Sunday." } }]);
    const urn = (await lines(id))[2];
    const counts = () => one<{ hi: string; ess: number }>(db,
      "select public.highest_item_priority(r)::text as hi, public.essential_item_count(r) as ess from public.requisitions r where id = $1", [id]);
    expect(await counts()).toEqual({ hi: "essential", ess: 1 });
    await amend(headId, id, [{ op: "remove", item_id: urn.id }]);
    expect(await counts()).toEqual({ hi: "medium", ess: 0 });
    await expectError(rpc(db, headId, "select public.set_requisition_item_priority($1, 'low') as r", [urn.id]), /was removed/);
  });
});

describe("history is append-only", () => {
  it("amendments and changes cannot be edited or deleted, by anyone", async () => {
    const id = await newRequisition();
    const [l1] = await lines(id);
    await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }]);
    await expectError(db.query("update public.requisition_amendments set reason = 'rewritten history' where requisition_id = $1", [id]), /append-only/);
    await expectError(db.query("delete from public.requisition_amendments where requisition_id = $1", [id]), /append-only/);
    await expectError(db.query("update public.requisition_item_changes set new_value = '1' where requisition_id = $1", [id]), /append-only/);
    await expectError(db.query("delete from public.requisition_item_changes where requisition_id = $1", [id]), /append-only/);
  });

  it("staff with requisitions.view can read the history", async () => {
    const id = await newRequisition();
    const [l1] = await lines(id);
    await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }]);
    const n = await as(db, "authenticated", viewerId, async () =>
      (await one<{ n: number }>(db, "select count(*)::int as n from public.requisition_item_changes where requisition_id = $1", [id])).n);
    expect(n).toBe(1);
  });
});

describe("audit", () => {
  it("records each change and a summary, with safe values only", async () => {
    const id = await newRequisition();
    const [l1, l2] = await lines(id);
    await amend(headId, id, [
      { op: "update", item_id: l1.id, fields: { quantity: "4", notes: "Call Jordan on +1 555 010 2000", vendor_url: "https://shop.example.com/beans?ref=abc123" } },
      { op: "remove", item_id: l2.id, reason: "Already in stock." },
      { op: "add", fields: { description: "Sugar", quantity: "1", estimated_unit_price: "2", priority: "low" } },
    ]);
    const logs = await db.query<{ action: string; actor_id: string; metadata: Record<string, unknown>; before_data: unknown; after_data: unknown }>(
      "select action, actor_id, metadata, before_data, after_data from public.audit_logs where requisition_id = $1 and action like 'requisition.%' and action <> 'requisition.submitted' order by occurred_at, action", [id]);
    expect(logs.rows.map((r) => r.action).sort()).toEqual([
      "requisition.amendment_submitted", "requisition.line_item_added", "requisition.line_item_removed", "requisition.line_item_updated"]);
    expect(logs.rows.every((r) => r.actor_id === headId)).toBe(true);
    const updated = logs.rows.find((r) => r.action === "requisition.line_item_updated")!;
    expect(updated.metadata).toMatchObject({ revision: 2, line_number: 1, status: "submitted", fields: ["quantity", "vendor_url", "notes"], reason: REASON });
    expect(updated.after_data).toEqual({ quantity: 4, vendor_url: "shop.example.com", notes: "[changed]" });
    const summary = logs.rows.find((r) => r.action === "requisition.amendment_submitted")!;
    expect(summary.metadata).toMatchObject({ revision: 2, lines_added: 1, lines_updated: 1, lines_removed: 1,
      estimated_total_before: 85, estimated_total_after: 81.96 });
    const all = JSON.stringify(logs.rows);
    expect(all).not.toMatch(/example\.org|555 010|\+1 \(555\)|ref=abc123|Jordan Example/i);
  });
});

describe("notification", () => {
  it("tells the assigned reviewer in-app (low importance: never pushed), not the person amending", async () => {
    const id = await newRequisition();
    await rpc(db, adminId, "select public.assign_requisition_reviewer($1, $2) as r", [id, headId]);
    const [l1] = await lines(id);
    await amend(adminId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "4" } }]);
    const n = await db.query<{ user_id: string; type: string; importance: string; title: string; link: string }>(
      "select user_id, type, importance::text, title, link from public.user_notifications where requisition_id = $1 and type = 'requisition.amended'", [id]);
    expect(n.rows).toEqual([{ user_id: headId, type: "requisition.amended", importance: "low", title: "Requisition amended", link: `/requisitions/${id}` }]);
    // The reviewer amending their own assignment gets nothing.
    await amend(headId, id, [{ op: "update", item_id: l1.id, fields: { quantity: "5" } }]);
    expect((await db.query("select 1 from public.user_notifications where requisition_id = $1 and type = 'requisition.amended'", [id])).rows).toHaveLength(1);
  });
});

describe("backward compatibility", () => {
  it("requisitions submitted before the migration become revision 1 with no data changed", async () => {
    const old = await createTestDatabase({ before: MIGRATION });
    await createUser(old, "head@example.org", ["head_of_finance"]);
    const oldIds = await lookup(old);
    await createFormToken(old);
    const r = await as(old, "service_role", null, async () =>
      (await one<{ r: { id: string } }>(old, "select public.submit_requisition($1, $2::jsonb, '[]'::jsonb, 'fp-old') as r",
        ["test-token-abcdefghijklmnopqrstuvwxyz-0123456789", JSON.stringify(payload(oldIds))])).r);
    const before = await old.query<Record<string, unknown>>("select * from public.requisition_items where requisition_id = $1 order by line_number", [r.id]);
    await applyMigrationsFrom(old, MIGRATION);
    const after = await old.query<Record<string, unknown>>("select * from public.requisition_items where requisition_id = $1 order by line_number", [r.id]);
    expect(after.rows.map((row) => ({ ...row, added_in_revision: undefined, last_changed_revision: undefined, removed_at: undefined, removed_in_amendment_id: undefined, removed_reason: undefined })))
      .toEqual(before.rows.map((row) => ({ ...row, added_in_revision: undefined, last_changed_revision: undefined, removed_at: undefined, removed_in_amendment_id: undefined, removed_reason: undefined })));
    expect(after.rows.every((row) => row.added_in_revision === 1 && row.removed_at === null && row.last_changed_revision === null)).toBe(true);
    expect(await one(old, "select current_revision, amended_at, amendment_review_required from public.requisitions where id = $1", [r.id]))
      .toEqual({ current_revision: 1, amended_at: null, amendment_review_required: false });
    await old.close();
  });
});
