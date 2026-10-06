/**
 * Line-item priority (migration 20261006000100): storage per line, Essential
 * justification rules, calculated highest priority, audit trail, permissions,
 * backfill of existing rows, and survival through the purchasing workflow.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, daysFromNow, FORM_TOKEN, lookup, payload, putObject, rpc, submit } from "./fixtures";

const MIGRATION = "20261006000100_line_item_priority.sql";

let db: Db;
let headId: string;
let viewerId: string;
let ids: Awaited<ReturnType<typeof lookup>>;

async function submitPrioritized(body: Record<string, unknown>) {
  return as(db, "service_role", null, async () => {
    const row = await one<{ r: Record<string, unknown> }>(
      db,
      "select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, $3) as r",
      [FORM_TOKEN, JSON.stringify(body), "fp-" + Math.random()],
    );
    return row.r as { id: string; requisition_number: string; items: { line_number: number; priority: string; essential_justification: string | null }[] };
  });
}

async function lines(reqId: string) {
  const r = await db.query<{ id: string; line_number: number; priority: string; essential_justification: string | null; review_status: string; approved_quantity: string | null }>(
    "select id, line_number, priority::text, essential_justification, review_status::text, approved_quantity::text from public.requisition_items where requisition_id = $1 order by line_number",
    [reqId],
  );
  return r.rows;
}

const ITEMS = [
  { description: "Wireless microphone system", quantity: "2", estimated_unit_price: "600", priority: "essential", essential_justification: "Required to replace failed equipment before Sunday service." },
  { description: "XLR cables", quantity: "4", estimated_unit_price: "40", priority: "medium" },
  { description: "Spare batteries", quantity: "10", estimated_unit_price: "2.50", priority: "low", essential_justification: "ignored for non-essential" },
  { description: "Mic clips", quantity: "6", estimated_unit_price: "5", priority: "high" },
];

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, "admin@example.org", ["administrator"]);
  headId = await createUser(db, "head@example.org", ["head_of_finance"]);
  viewerId = await createUser(db, "viewer@example.org", ["viewer"]);
  await db.query(
    "insert into public.role_permissions (role_id, permission_key) select id, 'requisitions.view' from public.roles where key = 'viewer' on conflict do nothing",
  );
  ids = await lookup(db);
  await createFormToken(db);
});

describe("submission with priorities", () => {
  it("stores an independent priority per line and the Essential justification only where Essential", async () => {
    const r = await submitPrioritized(payload(ids, { items: ITEMS }));
    const rows = await lines(r.id);
    expect(rows.map((i) => i.priority)).toEqual(["essential", "medium", "low", "high"]);
    expect(rows[0].essential_justification).toBe("Required to replace failed equipment before Sunday service.");
    expect(rows.slice(1).every((i) => i.essential_justification === null)).toBe(true);
    // Returned summary (used by the confirmation screen) carries priorities too.
    expect(r.items.map((i) => i.priority)).toEqual(["essential", "medium", "low", "high"]);
  });

  it("does not treat recording initial priorities as an audited change", async () => {
    const r = await submitPrioritized(payload(ids, { items: ITEMS }));
    const n = await one<{ n: number }>(db, "select count(*)::int as n from public.audit_logs where requisition_id = $1 and action = 'requisition_item.priority_changed'", [r.id]);
    expect(n.n).toBe(0);
  });

  it("rejects Essential without a justification — and creates nothing", async () => {
    const before = await one<{ n: number }>(db, "select count(*)::int as n from public.requisitions");
    await expectError(
      submitPrioritized(payload(ids, { items: [{ description: "Projector lamp", quantity: "1", estimated_unit_price: "300", priority: "essential", essential_justification: "  " }] })),
      /Explain why item 1 is essential/,
    );
    await expectError(
      submitPrioritized(payload(ids, { items: [{ description: "Projector lamp", quantity: "1", estimated_unit_price: "300", priority: "essential", essential_justification: "urgent" }] })),
      /at least 10 characters/,
    );
    const after = await one<{ n: number }>(db, "select count(*)::int as n from public.requisitions");
    expect(after.n).toBe(before.n);
  });

  it("does not require a justification for High, Medium or Low", async () => {
    for (const priority of ["high", "medium", "low"]) {
      const r = await submitPrioritized(payload(ids, { items: [{ description: "Gaffer tape", quantity: "1", estimated_unit_price: "12", priority }] }));
      expect((await lines(r.id))[0].priority).toBe(priority);
    }
  });

  it("requires a valid priority on every line", async () => {
    await expectError(
      submitPrioritized(payload(ids, { items: [{ description: "Gaffer tape", quantity: "1", estimated_unit_price: "12", priority: "high" }, { description: "Tape 2", quantity: "1", estimated_unit_price: "1" }] })),
      /Choose a priority for item 2/,
    );
    await expectError(
      submitPrioritized(payload(ids, { items: [{ description: "Gaffer tape", quantity: "1", estimated_unit_price: "12", priority: "urgent" }] })),
      /Choose a priority for item 1/,
    );
  });

  it("is reserved for trusted server code", async () => {
    await expectError(
      as(db, "anon", null, () => db.query("select public.submit_requisition_with_priority($1, '{}'::jsonb)", [FORM_TOKEN])),
      /permission denied/,
    );
    await expectError(
      as(db, "authenticated", headId, () => db.query("select public.submit_requisition_with_priority($1, '{}'::jsonb)", [FORM_TOKEN])),
      /permission denied/,
    );
  });

  it("the database itself refuses an Essential line without a reason, or a reason on a non-Essential line", async () => {
    const r = await submitPrioritized(payload(ids, { items: [{ description: "Gaffer tape", quantity: "1", estimated_unit_price: "12", priority: "high" }] }));
    const [line] = await lines(r.id);
    await expectError(db.query("update public.requisition_items set priority = 'essential' where id = $1", [line.id]), /essential_justification_check/);
    await expectError(db.query("update public.requisition_items set essential_justification = 'some reason here' where id = $1", [line.id]), /essential_justification_check/);
  });

  it("legacy submit_requisition still works and defaults lines to medium", async () => {
    const r = await submit(db, payload(ids));
    expect((await lines(r.id)).map((i) => i.priority)).toEqual(["medium", "medium"]);
  });
});

describe("highest priority is calculated from the line items", () => {
  it("a Low line never hides an Essential line; counts Essential lines", async () => {
    const mixed = await submitPrioritized(payload(ids, { items: [ITEMS[2], ITEMS[0], ITEMS[1]] }));
    const highOnly = await submitPrioritized(payload(ids, { items: [ITEMS[1], ITEMS[3]] }));
    const lowOnly = await submitPrioritized(payload(ids, { items: [ITEMS[2]] }));
    const rows = await as(db, "authenticated", headId, () =>
      db.query<{ id: string; highest: string; essentials: number }>(
        "select r.id, public.highest_item_priority(r)::text as highest, public.essential_item_count(r) as essentials from public.requisitions r where r.id = any($1::uuid[])",
        [[mixed.id, highOnly.id, lowOnly.id]],
      ),
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get(mixed.id)).toMatchObject({ highest: "essential", essentials: 1 });
    expect(byId.get(highOnly.id)).toMatchObject({ highest: "high", essentials: 0 });
    expect(byId.get(lowOnly.id)).toMatchObject({ highest: "low", essentials: 0 });
  });

  it("sorts Essential > High > Medium > Low and filters by highest priority", async () => {
    const order = await as(db, "authenticated", headId, () =>
      db.query<{ highest: string }>(
        "select public.highest_item_priority(r)::text as highest from public.requisitions r order by public.highest_item_priority(r) asc, r.submitted_at desc",
      ),
    );
    const ranks = order.rows.map((r) => ["essential", "high", "medium", "low"].indexOf(r.highest));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const essentialOnly = await as(db, "authenticated", headId, () =>
      db.query<{ n: number }>("select count(*)::int as n from public.requisitions r where public.highest_item_priority(r) = 'essential'"),
    );
    expect(essentialOnly.rows[0].n).toBeGreaterThan(0);
  });
});

describe("Finance review with priorities", () => {
  it("priority never approves anything: Essential and High lines can be held or rejected", async () => {
    const r = await submitPrioritized(payload(ids, { items: [ITEMS[0], ITEMS[3], ITEMS[1]] }));
    const before = await lines(r.id);
    expect(before.every((i) => i.review_status === "pending")).toBe(true);
    await rpc(db, headId, "select public.review_requisition($1, 'partial', $2::jsonb) as r", [r.id, JSON.stringify([
      { item_id: before[0].id, decision: "rejected", comment: "Borrow from youth ministry" },
      { item_id: before[1].id, decision: "held", comment: "Need a quote" },
      { item_id: before[2].id, decision: "approved", approved_quantity: "4", approved_unit_price: "40" },
    ])]);
    const after = await lines(r.id);
    expect(after.map((i) => [i.priority, i.review_status])).toEqual([["essential", "rejected"], ["high", "held"], ["medium", "approved"]]);
  });

  it("lets a reviewer change a priority, with a full audit entry", async () => {
    const r = await submitPrioritized(payload(ids, { items: [ITEMS[1]] }));
    const [line] = await lines(r.id);
    const out = await rpc<{ previous_priority: string; priority: string; changed: boolean }>(
      db, headId, "select public.set_requisition_item_priority($1, 'essential', 'Sunday service cannot run without it') as r", [line.id],
    );
    expect(out).toMatchObject({ previous_priority: "medium", priority: "essential", changed: true });
    const audit = await one<{ actor_id: string; before_data: { priority: string }; after_data: { priority: string; essential_justification: string }; metadata: { line_number: number; from: string; to: string }; occurred_at: string }>(
      db,
      "select actor_id, before_data, after_data, metadata, occurred_at from public.audit_logs where entity_id = $1 and action = 'requisition_item.priority_changed'",
      [line.id],
    );
    expect(audit.actor_id).toBe(headId);
    expect(audit.before_data.priority).toBe("medium");
    expect(audit.after_data).toMatchObject({ priority: "essential", essential_justification: "Sunday service cannot run without it" });
    expect(audit.metadata).toMatchObject({ line_number: 1, from: "medium", to: "essential" });
    expect(audit.occurred_at).toBeTruthy();

    // Downgrading clears the justification (kept in the audit log).
    await rpc(db, headId, "select public.set_requisition_item_priority($1, 'low') as r", [line.id]);
    expect((await lines(r.id))[0]).toMatchObject({ priority: "low", essential_justification: null, review_status: "pending" });
  });

  it("validates priority changes and requires the review permission", async () => {
    const r = await submitPrioritized(payload(ids, { items: [ITEMS[1]] }));
    const [line] = await lines(r.id);
    await expectError(rpc(db, headId, "select public.set_requisition_item_priority($1, 'essential') as r", [line.id]), /Explain why this item is essential/);
    await expectError(rpc(db, headId, "select public.set_requisition_item_priority($1, 'urgent') as r", [line.id]), /Choose a valid priority/);
    await expectError(rpc(db, viewerId, "select public.set_requisition_item_priority($1, 'high') as r", [line.id]), /permission denied/);
    // No direct writes, even for reviewers.
    await expectError(
      as(db, "authenticated", headId, () => db.query("update public.requisition_items set priority = 'high' where id = $1", [line.id])),
      /permission denied/,
    );
    expect((await lines(r.id))[0].priority).toBe("medium");
  });

  it("viewers can read priorities through the same RLS as the requisition", async () => {
    const r = await submitPrioritized(payload(ids, { items: [ITEMS[0]] }));
    const seen = await as(db, "authenticated", viewerId, () =>
      db.query<{ priority: string; highest: string }>(
        "select i.priority::text, public.highest_item_priority(r)::text as highest from public.requisition_items i join public.requisitions r on r.id = i.requisition_id where r.id = $1",
        [r.id],
      ),
    );
    expect(seen.rows).toEqual([{ priority: "essential", highest: "essential" }]);
    const anon = await as(db, "anon", null, () => db.query("select public.highest_item_priority(r) from public.requisitions r limit 1").catch((e: Error) => e));
    expect(String(anon)).toMatch(/permission denied/);
  });
});

describe("priority survives the purchasing workflow", () => {
  it("is unchanged after approval, PO, vendor order, receipt and reconciliation", async () => {
    const r = await submitPrioritized(payload(ids, { items: [ITEMS[0], ITEMS[1]] }));
    const [mic, cables] = await lines(r.id);
    await rpc(db, headId, "select public.review_requisition($1, 'approve') as r", [r.id]);
    await rpc(db, headId, "select public.issue_purchase_order($1) as r", [r.id]);
    await rpc(db, headId, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r", [
      r.id, JSON.stringify({ vendor_name: "AV Supply", order_date: daysFromNow(0) }),
      JSON.stringify([{ requisition_item_id: mic.id, quantity: "2" }, { requisition_item_id: cables.id, quantity: "4" }]),
    ]);
    await putObject(db, `requisitions/${r.id}/receipt.pdf`);
    const receiptId = await rpc<string>(db, headId, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
      [r.id, JSON.stringify([{ path: `requisitions/${r.id}/receipt.pdf`, original_filename: "receipt.pdf" }])]);
    await rpc(db, headId, "select public.reconcile_receipt($1, $2::jsonb) as r", [receiptId, JSON.stringify([
      { requisition_item_id: mic.id, quantity: "2", actual_amount: "1150" },
      { requisition_item_id: cables.id, quantity: "4", actual_amount: "160" },
    ])]);
    const final = await lines(r.id);
    expect(final.map((i) => [i.priority, i.essential_justification])).toEqual([
      ["essential", "Required to replace failed equipment before Sunday service."],
      ["medium", null],
    ]);
    const status = await one<{ status: string; estimated_total: string }>(db, "select status::text, estimated_total::text from public.requisitions where id = $1", [r.id]);
    expect(status.status).toBe("purchased");
    // Priority never affects money: 2 × 600 + 4 × 40
    expect(status.estimated_total).toBe("1360.00");
  });
});

describe("migration backfill", () => {
  it("defaults every existing line item to medium without inferring anything", async () => {
    const legacy = await createTestDatabase({ before: MIGRATION });
    await createFormToken(legacy);
    const legacyIds = await lookup(legacy);
    const big = await submit(legacy, payload(legacyIds, { items: [{ description: "URGENT ESSENTIAL generator", quantity: "1", estimated_unit_price: "25000" }] }));
    await submit(legacy, payload(legacyIds));
    await applyMigrationsFrom(legacy, MIGRATION);
    const rows = await legacy.query<{ priority: string; essential_justification: string | null }>(
      "select priority::text, essential_justification from public.requisition_items",
    );
    expect(rows.rows.length).toBe(3);
    expect(rows.rows.every((r) => r.priority === "medium" && r.essential_justification === null)).toBe(true);
    const audit = await legacy.query("select 1 from public.audit_logs where action = 'requisition_item.priority_changed'");
    expect(audit.rows).toHaveLength(0);
    const highest = await one<{ h: string }>(legacy, "select public.highest_item_priority(r)::text as h from public.requisitions r where id = $1", [big.id]);
    expect(highest.h).toBe("medium");
  });
});
