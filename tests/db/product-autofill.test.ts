/**
 * Product URL auto-fill (migration 20261008000100): the immutable submitted
 * snapshot, per-status attribution rules, the snapshot guard trigger, audit
 * entries, grants, backward compatibility and survival through the full
 * purchasing workflow.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, FORM_TOKEN, lookup, payload, putObject, rpc, submit } from "./fixtures";

const MIGRATION = "20261008000100_product_autofill.sql";
const URL_A = "https://www.officedepot.com/a/products/5791037/Chair/";

let db: Db;
let headId: string;
let ids: Awaited<ReturnType<typeof lookup>>;

const SNAPSHOT_COLUMNS = `requested_brand, requested_model, requested_sku, lookup_status::text, lookup_method::text, lookup_domain,
  lookup_fetched_at, lookup_price::text, lookup_currency, lookup_values, lookup_edited_fields,
  description, specifications, color, size, quantity::text, estimated_unit_price::text, estimated_total::text, vendor_name, vendor_url, notes`;

type Line = Record<string, unknown> & { id: string; line_number: number };

/** The shared fixture's items have no priority (it predates priorities); the priority wrapper requires one. */
function withPriority(body: Record<string, unknown>) {
  return { ...body, items: (body.items as Record<string, unknown>[]).map((i) => ({ priority: "medium", ...i })) };
}

async function submitWithProduct(input: Record<string, unknown>, target: Db = db) {
  const body = withPriority(input);
  return as(target, "service_role", null, async () => {
    const row = await one<{ r: Record<string, unknown> }>(
      target,
      "select public.submit_requisition_with_product($1, $2::jsonb, '[]'::jsonb, $3) as r",
      [FORM_TOKEN, JSON.stringify(body), "fp-" + Math.random()],
    );
    return row.r as { id: string; requisition_number: string; estimated_total: string; items: { line_number: number; priority: string }[] };
  });
}

async function lines(reqId: string, target: Db = db): Promise<Line[]> {
  const r = await target.query<Line>(`select id, line_number, ${SNAPSHOT_COLUMNS} from public.requisition_items where requisition_id = $1 order by line_number`, [reqId]);
  return r.rows;
}

async function count(sql: string, params: unknown[] = []) {
  return (await one<{ n: number }>(db, sql, params)).n;
}

const VERIFIED = {
  status: "verified", method: "structured_data", domain: "officedepot.com", fetched_at: "2026-10-05T18:30:00.000Z",
  price: "249.99", currency: "USD", values: { title: "Mesh Chair", brand: "Realspace", sku: "5791037" }, edited_fields: ["estimated_unit_price"],
};

const productItems = () => [
  { description: "Mesh Chair", quantity: "2", estimated_unit_price: "229.00", vendor_name: "Office Depot", vendor_url: URL_A, priority: "high",
    requested_brand: "Realspace", requested_model: "BX-200", requested_sku: "5791037", lookup: VERIFIED },
  { description: "Folding table", quantity: "1", estimated_unit_price: "59", vendor_url: URL_A, priority: "medium", requested_brand: "Lifetime", lookup: { status: "expired" } },
  { description: "Mic stand", quantity: "3", estimated_unit_price: "25", vendor_url: "https://www.sweetwater.com/x", priority: "low", lookup: { status: "url_changed" } },
  { description: "Cable", quantity: "4", estimated_unit_price: "10", vendor_url: URL_A, priority: "medium",
    lookup: { status: "rejected", reason: "signature", method: "structured_data", domain: "evil.example", price: "1.00", currency: "USD" } },
  { description: "Batteries", quantity: "10", estimated_unit_price: "2.50", priority: "medium" },
];

beforeAll(async () => {
  db = await createTestDatabase();
  await createUser(db, "admin@example.org", ["administrator"]);
  headId = await createUser(db, "head@example.org", ["head_of_finance"]);
  ids = await lookup(db);
  await createFormToken(db);
});

describe("submission with product details", () => {
  it("stores attribution only for verified lines; every other status keeps typed values without attribution", async () => {
    const r = await submitWithProduct(payload(ids, { items: productItems() }));
    expect(r.requisition_number).toMatch(/^TKT-REQ-/);
    expect(r.items.map((i) => i.priority)).toEqual(["high", "medium", "low", "medium", "medium"]);
    const [verified, expired, changed, rejected, manual] = await lines(r.id);
    expect(verified).toMatchObject({
      requested_brand: "Realspace", requested_model: "BX-200", requested_sku: "5791037",
      lookup_status: "verified", lookup_method: "structured_data", lookup_domain: "officedepot.com",
      lookup_price: "249.99", lookup_currency: "USD", lookup_values: { title: "Mesh Chair", brand: "Realspace", sku: "5791037" },
      lookup_edited_fields: ["estimated_unit_price"], estimated_unit_price: "229.00",
    });
    expect(new Date(verified.lookup_fetched_at as string).toISOString()).toBe("2026-10-05T18:30:00.000Z");
    const none = { lookup_method: null, lookup_domain: null, lookup_fetched_at: null, lookup_price: null, lookup_currency: null, lookup_values: null, lookup_edited_fields: [] };
    expect(expired).toMatchObject({ ...none, lookup_status: "expired", requested_brand: "Lifetime", description: "Folding table" });
    expect(changed).toMatchObject({ ...none, lookup_status: "url_changed" });
    // A rejected line's claimed attribution is never persisted, whatever the payload says.
    expect(rejected).toMatchObject({ ...none, lookup_status: "rejected", description: "Cable" });
    expect(manual).toMatchObject({ ...none, lookup_status: "none", requested_brand: null, requested_model: null, requested_sku: null });
    // Money is untouched: the requested price is the snapshot, the reference price is separate.
    expect(r.estimated_total).toBe("657.00"); // 2×229 + 59 + 3×25 + 4×10 + 10×2.50
  });

  it("writes one lookup audit entry with counts, and one for rejected tokens", async () => {
    const r = await submitWithProduct(payload(ids, { items: productItems() }));
    const audits = await db.query<{ action: string; metadata: Record<string, unknown>; actor_label: string }>(
      "select action, metadata, actor_label from public.audit_logs where requisition_id = $1 and action like 'requisition.product_lookup%' order by action", [r.id]);
    expect(audits.rows).toEqual([
      { action: "requisition.product_lookup", actor_label: "external:jordan@example.org",
        metadata: { verified: 1, expired: 1, url_changed: 1, rejected: 1, methods: { structured_data: 1, open_graph: 0, url_hint: 0 }, edited_lines: 1 } },
      { action: "requisition.product_lookup_rejected", actor_label: "external:jordan@example.org", metadata: { lines: [4], reasons: ["signature"] } },
    ]);
    // No token contents, URLs or prices are written to the audit log.
    expect(JSON.stringify(audits.rows)).not.toMatch(/officedepot|evil|249|1\.00/);
  });

  it("manual-only submissions add no product audit entries and store the defaults", async () => {
    const r = await submitWithProduct(payload(ids));
    expect(await count("select count(*)::int as n from public.audit_logs where requisition_id = $1 and action like 'requisition.product_lookup%'", [r.id])).toBe(0);
    expect((await lines(r.id)).every((l) => l.lookup_status === "none" && (l.lookup_edited_fields as string[]).length === 0)).toBe(true);
  });

  it("is all-or-nothing: an invalid line creates nothing", async () => {
    const before = await count("select count(*)::int as n from public.requisitions");
    const bad = (lookupValue: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      submitWithProduct(payload(ids, { items: [{ description: "Chair", quantity: "1", estimated_unit_price: "10", vendor_url: URL_A, lookup: lookupValue, ...extra }] }));
    await expectError(bad({ status: "trusted" }), /Invalid product lookup status/);
    await expectError(bad({ ...VERIFIED, method: "url_hint" }), /hint_no_price_check/);
    await expectError(bad({ ...VERIFIED, currency: "usd" }), /currency_check/);
    await expectError(bad({ ...VERIFIED, domain: "Bad Domain!" }), /domain_check/);
    await expectError(bad({ ...VERIFIED, edited_fields: ["approved_total"] }), /edited_check/);
    await expectError(bad(VERIFIED, { vendor_url: null }), /lookup_consistency_check/);
    await expectError(bad({ ...VERIFIED, method: null }), /lookup_consistency_check|null value|invalid input/);
    await expectError(bad({ status: "verified", method: "open_graph" }), /lookup_consistency_check|null value/);
    await expectError(bad({ status: "none" }, { priority: "urgent" }), /Choose a priority/);
    expect(await count("select count(*)::int as n from public.requisitions")).toBe(before);
  });

  it("trims requester text to the column limits, like the existing fields", async () => {
    const r = await submitWithProduct(payload(ids, { items: [{ description: "Chair", quantity: "1", estimated_unit_price: "10", requested_brand: `  ${"b".repeat(130)}  `, requested_sku: "   " }] }));
    const [row] = await lines(r.id);
    expect(row.requested_brand).toBe("b".repeat(120));
    expect(row.requested_sku).toBeNull();
  });

  it("only trusted server code can call it", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expectError(
        as(db, role, role === "authenticated" ? headId : null, () =>
          db.query("select public.submit_requisition_with_product($1, $2::jsonb, '[]'::jsonb, null)", [FORM_TOKEN, JSON.stringify(payload(ids))])),
        /permission denied/,
      );
    }
  });

  it("the existing submission functions still work unchanged and store the defaults", async () => {
    const base = await submit(db, payload(ids));
    const prioritized = await as(db, "service_role", null, async () =>
      (await one<{ r: { id: string } }>(db, "select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, null) as r", [FORM_TOKEN, JSON.stringify(withPriority(payload(ids)))])).r);
    for (const id of [base.id, prioritized.id]) {
      const rows = await lines(id);
      expect(rows).toHaveLength(2);
      expect(rows.every((l) => l.lookup_status === "none" && l.requested_brand === null && l.lookup_values === null)).toBe(true);
    }
  });
});

describe("snapshot guard", () => {
  let line: Line;
  let reqId: string;

  beforeAll(async () => {
    const r = await submitWithProduct(payload(ids, { items: productItems().slice(0, 2) }));
    reqId = r.id;
    line = (await lines(r.id))[0];
  });

  it.each([
    ["description", "'Changed'"], ["specifications", "'Changed'"], ["color", "'Red'"], ["size", "'XL'"], ["quantity", "3"],
    ["estimated_unit_price", "1"], ["estimated_total", "1"], ["vendor_name", "'Other'"], ["vendor_url", "'https://other.example.com/'"], ["notes", "'Changed'"],
    ["requested_brand", "'Other'"], ["requested_model", "'Other'"], ["requested_sku", "'Other'"], ["requested_sku", "null"],
    ["lookup_status", "'none'"], ["lookup_method", "'url_hint'"], ["lookup_domain", "'evil.example'"], ["lookup_fetched_at", "now()"],
    ["lookup_price", "1"], ["lookup_currency", "'CAD'"], ["lookup_values", "'{}'::jsonb"], ["lookup_edited_fields", "'{}'"],
  ])("blocks changing %s after submission (even as the database owner)", async (column, value) => {
    await expectError(db.query(`update public.requisition_items set ${column} = ${value} where id = $1`, [line.id]), /submitted line item cannot be changed/);
  });

  it("applies to service_role too", async () => {
    await expectError(
      as(db, "service_role", null, () => db.query("update public.requisition_items set estimated_unit_price = 1 where id = $1", [line.id])),
      /submitted line item cannot be changed/,
    );
  });

  it("setting the initialization flag in a later transaction does not reopen the snapshot", async () => {
    await db.exec("begin");
    try {
      await db.query("select set_config('app.product_initializing', $1, true)", [reqId]);
      await expectError(db.query("update public.requisition_items set requested_brand = 'Forged' where id = $1", [line.id]), /submitted line item cannot be changed/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("the flag only opens rows of its own requisition, created in the same transaction", async () => {
    await db.exec("begin");
    try {
      const other = await submit(db, payload(ids)); // inserted in THIS transaction
      const [otherLine] = await lines(other.id);
      await db.query("select set_config('app.product_initializing', $1, true)", [reqId]); // flag for a different requisition
      await expectError(db.query("update public.requisition_items set requested_brand = 'Forged' where id = $1", [otherLine.id]), /cannot be changed/);
    } finally {
      await db.exec("rollback");
    }
  });

  it("blocks inserting product details outside the submission function", async () => {
    await expectError(
      db.query(
        `insert into public.requisition_items (requisition_id, line_number, description, quantity, estimated_unit_price, estimated_total, lookup_status)
         values ($1, 99, 'Injected', 1, 1, 1, 'rejected')`, [reqId]),
      /only be recorded when a requisition is submitted/,
    );
    await expectError(
      db.query(
        `insert into public.requisition_items (requisition_id, line_number, description, quantity, estimated_unit_price, estimated_total, requested_sku)
         values ($1, 99, 'Injected', 1, 1, 1, 'X')`, [reqId]),
      /only be recorded when a requisition is submitted/,
    );
  });

  it("leaves non-snapshot columns writable (priority, review, progress caches, cancellation)", async () => {
    await rpc(db, headId, "select public.set_requisition_item_priority($1, 'low') as r", [line.id]);
    await db.query("update public.requisition_items set review_comment = 'ok', cancel_reason = null where id = $1", [line.id]);
    expect((await one<{ p: string }>(db, "select priority::text as p from public.requisition_items where id = $1", [line.id])).p).toBe("low");
  });

  it("allows no-op updates of snapshot columns", async () => {
    await db.query("update public.requisition_items set description = description, lookup_values = lookup_values where id = $1", [line.id]);
  });
});

describe("the snapshot survives every existing workflow unchanged", () => {
  it("priority, review (partial approval with hold/reject), PO, vendor order, receipt, reconciliation, cancellation, close and reporting", async () => {
    const r = await submitWithProduct(payload(ids, { items: productItems().slice(0, 3) }));
    const before = await lines(r.id);
    const [chair, table, stand] = before;
    const today = (await one<{ d: string }>(db, "select private.church_today()::text as d")).d;

    await rpc(db, headId, "select public.set_requisition_item_priority($1, 'essential', 'Needed for the welcome team on Sunday.') as r", [table.id]);
    await rpc(db, headId, "select public.start_requisition_review($1) as r", [r.id]);
    const reviewed = await rpc<{ status: string }>(db, headId, "select public.review_requisition($1, 'partial', $2::jsonb) as r", [r.id, JSON.stringify([
      { item_id: chair.id, decision: "approved", approved_quantity: "2", approved_unit_price: "225.00" },
      { item_id: table.id, decision: "approved", approved_quantity: "1", approved_unit_price: "59.00" },
      { item_id: stand.id, decision: "rejected", comment: "Already have stands" },
    ])]);
    expect(reviewed.status).toBe("partially_approved");
    await rpc(db, headId, "select public.issue_purchase_order($1) as r", [r.id]);
    await rpc(db, headId, "select public.record_vendor_order($1, $2::jsonb, $3::jsonb) as r", [
      r.id, JSON.stringify({ vendor_name: "Office Depot", order_date: today }),
      JSON.stringify([{ requisition_item_id: chair.id, quantity: "2" }, { requisition_item_id: table.id, quantity: "1" }]),
    ]);
    await putObject(db, `requisitions/${r.id}/receipt.pdf`);
    const receiptId = await rpc<string>(db, headId, "select public.register_receipt($1, null, '{}'::jsonb, $2::jsonb) as r",
      [r.id, JSON.stringify([{ path: `requisitions/${r.id}/receipt.pdf`, original_filename: "receipt.pdf" }])]);
    await rpc(db, headId, "select public.reconcile_receipt($1, $2::jsonb) as r", [receiptId, JSON.stringify([{ requisition_item_id: chair.id, quantity: "2", actual_amount: "440.00" }])]);
    const cancelled = await rpc<{ status: string }>(db, headId, "select public.cancel_item_remaining($1, '1', 'Discontinued') as r", [table.id]);
    expect(cancelled.status).toBe("purchased");
    await rpc(db, headId, "select public.close_requisition($1) as r", [r.id]);
    // Reporting reads (as Finance) still work.
    await as(db, "authenticated", headId, () => db.query("select * from public.service_category_totals(current_date - 30, current_date + 1)"));

    const after = await lines(r.id);
    expect(after).toEqual(before); // every snapshot column identical
    const req = await one<{ status: string; actual_total: string; estimated_total: string }>(db, "select status::text, actual_total::text, estimated_total::text from public.requisitions where id = $1", [r.id]);
    expect(req).toEqual({ status: "closed", actual_total: "440.00", estimated_total: "592.00" });
    const progress = await db.query<{ approved_unit_price: string; purchased_quantity: string; cancelled_quantity: string }>(
      "select approved_unit_price::text, purchased_quantity::text, cancelled_quantity::text from public.requisition_items where requisition_id = $1 order by line_number", [r.id]);
    expect(progress.rows.slice(0, 2)).toEqual([
      { approved_unit_price: "225.00", purchased_quantity: "2.00", cancelled_quantity: "0.00" },
      { approved_unit_price: "59.00", purchased_quantity: "0.00", cancelled_quantity: "1.00" },
    ]);
  });
});

describe("existing data", () => {
  it("historical rows read as 'none' with empty product fields after the migration, and stay protected", async () => {
    const legacy = await createTestDatabase({ before: MIGRATION });
    await createFormToken(legacy);
    const legacyIds = await lookup(legacy);
    const old = await submit(legacy, payload(legacyIds));
    await applyMigrationsFrom(legacy, MIGRATION);
    const rows = await lines(old.id, legacy);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        lookup_status: "none", lookup_method: null, lookup_domain: null, lookup_fetched_at: null, lookup_price: null,
        lookup_currency: null, lookup_values: null, lookup_edited_fields: [], requested_brand: null, requested_model: null, requested_sku: null,
      });
    }
    expect(rows[0]).toMatchObject({ description: "Coffee beans", estimated_unit_price: "19.99", vendor_name: "Coffee Co" });
    await expectError(legacy.query("update public.requisition_items set estimated_unit_price = 1 where id = $1", [rows[0].id]), /cannot be changed/);
    // New submissions work on the migrated database.
    const fresh = await submitWithProduct(payload(legacyIds, { items: productItems().slice(0, 1) }), legacy);
    expect((await lines(fresh.id, legacy))[0].lookup_status).toBe("verified");
  });
});
