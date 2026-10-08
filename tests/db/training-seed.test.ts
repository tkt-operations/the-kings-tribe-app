/**
 * supabase/training: the TRAINING guard, the training seed and the scenario
 * reset, run against the real migrations in PGlite (local only — never a
 * remote database).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const DIR = path.join(process.cwd(), "supabase", "training");
const sql = (file: string, scenario = "all") => readFileSync(path.join(DIR, file), "utf8").replaceAll("__TRAINING_SCENARIO__", scenario);
const count = async (db: Db, query: string, params: unknown[] = []) => Number((await one<{ n: string }>(db, `select count(*) as n from (${query}) q`, params)).n);

async function setChurchName(db: Db, name: string) {
  await db.query("update public.church_settings set church_name = $1 where id = 1", [name]);
}

async function createTrainingStaff(db: Db) {
  return {
    morgan: await createUser(db, "morgan.ellis@training.invalid", ["administrator"], "Morgan Ellis"),
    taylor: await createUser(db, "taylor.brooks@training.invalid", ["head_of_finance"], "Taylor Brooks"),
    riley: await createUser(db, "riley.chen@training.invalid", ["finance_user"], "Riley Chen"),
    sam: await createUser(db, "sam.patel@training.invalid", ["reporting_user"], "Sam Patel"),
    casey: await createUser(db, "casey.rivera@training.invalid", ["viewer"], "Casey Rivera"),
  };
}

const statusOf = async (db: Db, key: string) =>
  (await one<{ status: string }>(db, "select status::text from public.requisitions where submission_fingerprint = $1", [`training:${key}`])).status;

describe("training guard", () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDatabase();
    await createTrainingStaff(db);
  });

  it.each(["The Kings Tribe", "Kings Tribe Operations", "Train church"])("refuses a database named %j and writes nothing", async (name) => {
    await setChurchName(db, name);
    await expectError(db.exec(sql("guard.sql")), /TRAINING GUARD: refusing/);
    await expectError(db.exec(sql("seed_training.sql")), /TRAINING GUARD: refusing/);
    await expectError(db.exec(sql("reset_scenarios.sql")), /TRAINING GUARD: refusing/);
    expect(await count(db, "select 1 from public.requisitions")).toBe(0);
    expect(await count(db, "select 1 from public.external_form_tokens")).toBe(0);
    expect(await count(db, "select 1 from public.service_dates")).toBe(0);
  });

  it("refuses to run when the scenario placeholder was not filled in by the wrapper", async () => {
    await setChurchName(db, "The Kings Tribe (TRAINING)");
    const raw = (file: string) => readFileSync(path.join(DIR, file), "utf8");
    await expectError(db.exec(raw("seed_training.sql")), /unknown scenario "__TRAINING_SCENARIO__"/);
    await expectError(db.exec(raw("reset_scenarios.sql")), /unknown scenario "__TRAINING_SCENARIO__"/);
    await expectError(db.exec(sql("seed_training.sql", "not_a_scenario")), /unknown scenario/);
    expect(await count(db, "select 1 from public.requisitions")).toBe(0);
  });

  it("passes on a database whose church name contains TRAINING", async () => {
    await setChurchName(db, "The Kings Tribe (Training)");
    await db.exec(sql("guard.sql"));
  });
});

describe("training seed and reset", () => {
  let db: Db;
  let staff: Awaited<ReturnType<typeof createTrainingStaff>>;
  beforeAll(async () => {
    db = await createTestDatabase();
    await setChurchName(db, "The Kings Tribe (TRAINING)");
  });

  it("requires the training staff accounts and writes nothing without them", async () => {
    await expectError(db.exec(sql("seed_training.sql")), /create these active training users in the app first: Morgan Ellis \(Administrator\); Taylor Brooks/);
    expect(await count(db, "select 1 from public.requisitions")).toBe(0);
    staff = await createTrainingStaff(db);
  });

  it("creates every planned scenario through the real workflow, without demo flags", async () => {
    await db.exec(sql("seed_training.sql"));
    const expected: Record<string, string> = {
      priority_mix: "submitted", review_take_1: "under_review", review_take_2: "submitted", review_take_3: "submitted",
      ready_for_po: "approved", ready_for_po_direct: "approved", ready_to_order: "po_issued", receipt_pending: "ordered",
      partial_purchase: "partially_purchased", advance_due: "approved", ready_to_close: "purchased",
      on_hold_example: "on_hold", rejected_example: "rejected", partially_approved: "partially_approved",
    };
    for (const [key, status] of Object.entries(expected)) expect([key, await statusOf(db, key)]).toEqual([key, status]);
    expect(await count(db, "select 1 from public.requisitions where submission_fingerprint like 'training:history:%'")).toBe(6);
    expect(await count(db, "select 1 from public.requisitions where submission_fingerprint like 'training:history:%' and status = 'closed'")).toBe(4);
    expect(await count(db, "select 1 from public.requisitions where is_demo")).toBe(0);
    expect(await count(db, "select 1 from public.requisitions where requester_name <> 'Jamie Carter' or requester_email <> 'jamie.carter@demo.invalid'")).toBe(0);
  });

  it("covers every priority, with an Essential reason", async () => {
    const rows = await db.query<{ priority: string; reason: string | null }>(
      "select i.priority::text, i.essential_justification as reason from public.requisition_items i join public.requisitions r on r.id = i.requisition_id where r.submission_fingerprint = 'training:priority_mix' order by i.line_number");
    expect(rows.rows.map((r) => r.priority)).toEqual(["essential", "high", "medium", "low"]);
    expect(rows.rows[0].reason).toMatch(/sanctuary receiver failed/);
  });

  it("partially approves through the real review: one line in full, one reduced, one rejected", async () => {
    const r = await one<{ status: string; outcome: string; reviewer: string; type: string }>(db,
      "select r.status::text, r.review_outcome::text as outcome, r.reviewed_by::text as reviewer, t.key as type from public.requisitions r join public.request_types t on t.id = r.request_type_id where submission_fingerprint = 'training:partially_approved'");
    expect(r).toEqual({ status: "partially_approved", outcome: "partially_approved", reviewer: staff.taylor, type: "order" });
    const lines = await db.query<{ review_status: string; quantity: string; approved_quantity: string | null; priority: string; has_comment: boolean }>(
      "select i.review_status::text, i.quantity::text, i.approved_quantity::text, i.priority::text, i.review_comment is not null as has_comment from public.requisition_items i join public.requisitions r on r.id = i.requisition_id where r.submission_fingerprint = 'training:partially_approved' order by i.line_number");
    expect(lines.rows.map((l) => [l.review_status, Number(l.quantity), l.approved_quantity === null ? null : Number(l.approved_quantity), l.priority, l.has_comment])).toEqual([
      ["approved", 6, 6, "high", false],
      ["approved", 10, 4, "medium", true],
      ["rejected", 1, null, "low", true],
    ]);
  });

  it("produces the purchasing states the screenshots need", async () => {
    expect(await count(db, "select 1 from public.receipts r join public.requisitions q on q.id = r.requisition_id where q.submission_fingerprint = 'training:receipt_pending' and r.status = 'pending'")).toBe(1);
    expect(await count(db, "select 1 from public.purchase_orders p join public.requisitions q on q.id = p.requisition_id where q.submission_fingerprint = 'training:ready_to_order' and p.status = 'issued'")).toBe(1);
    expect(await count(db, "select 1 from public.vendor_orders v join public.requisitions q on q.id = v.requisition_id where q.submission_fingerprint = 'training:ready_to_order'")).toBe(0);
    const take1 = await one<{ assigned: string; comments: string }>(db,
      "select assigned_reviewer_id::text as assigned, (select count(*) from public.requisition_comments c where c.requisition_id = r.id)::text as comments from public.requisitions r where submission_fingerprint = 'training:review_take_1'");
    expect(take1).toEqual({ assigned: staff.taylor, comments: "1" });
  });

  it("creates genuine in-app notifications for the training staff (non-demo records notify)", async () => {
    expect(await count(db, "select 1 from public.user_notifications where user_id = $1", [staff.taylor])).toBeGreaterThan(0);
    expect(await count(db, "select 1 from public.user_notifications where user_id = $1", [staff.morgan])).toBeGreaterThan(0);
    expect(await count(db, "select 1 from public.user_notifications where user_id = $1", [staff.casey])).toBe(0); // viewer: no requisition access
  });

  it("records 26 weeks of Sundays plus a Special Service, leaving the current Sunday empty", async () => {
    expect(await count(db, "select 1 from public.service_dates where service_name = 'Sunday Service' and notes = 'Training data'")).toBe(26);
    expect(await count(db, "select 1 from public.service_dates where service_name = 'Special Service'")).toBe(1);
    expect(await count(db, "select 1 from public.service_dates where service_date = private.church_today() - extract(dow from private.church_today())::int")).toBe(0);
    expect(await count(db, "select 1 from public.attendance_entries where entered_by = $1", [staff.sam])).toBeGreaterThan(0);
    expect(await count(db, "select 1 from public.finance_entries where entered_by = $1", [staff.riley])).toBeGreaterThan(0);
  });

  it("revokes its own requisition link", async () => {
    expect(await count(db, "select 1 from public.external_form_tokens where is_active")).toBe(0);
    expect(await count(db, "select 1 from public.external_form_tokens where label = 'Training seed link (revoked)'")).toBe(1);
  });

  it("is idempotent: running it again creates nothing new", async () => {
    const before = await count(db, "select 1 from public.requisitions");
    const sundays = await count(db, "select 1 from public.service_dates");
    await db.exec(sql("seed_training.sql"));
    expect(await count(db, "select 1 from public.requisitions")).toBe(before);
    expect(await count(db, "select 1 from public.service_dates")).toBe(sundays);
  });

  it("resets one scenario to its starting state without touching the others", async () => {
    const take2 = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_2'");
    const other = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_3'");
    // A trainee works through take 2 during a recording...
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [staff.taylor]);
    await db.query("select public.review_requisition($1, 'approve')", [take2.id]);
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    expect(await statusOf(db, "review_take_2")).toBe("approved");
    // ...then the scenario is reset and re-seeded.
    await db.exec(sql("reset_scenarios.sql", "review_take_2"));
    expect(await count(db, "select 1 from public.requisitions where submission_fingerprint = 'training:review_take_2'")).toBe(0);
    await db.exec(sql("seed_training.sql", "review_take_2"));
    const fresh = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_2'");
    expect(fresh.id).not.toBe(take2.id);
    expect(await statusOf(db, "review_take_2")).toBe("submitted");
    expect((await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:review_take_3'")).id).toBe(other.id);
  });

  it("reset all clears training data but keeps users, settings and the audit log", async () => {
    const audit = await count(db, "select 1 from public.audit_logs");
    await db.exec(sql("reset_scenarios.sql", "all"));
    expect(await count(db, "select 1 from public.requisitions")).toBe(0);
    expect(await count(db, "select 1 from public.service_dates")).toBe(0);
    expect(await count(db, "select 1 from public.user_notifications")).toBe(0);
    expect(await count(db, "select 1 from public.profiles where is_active")).toBe(5);
    expect(await count(db, "select 1 from public.audit_logs")).toBeGreaterThanOrEqual(audit);
    await db.exec(sql("seed_training.sql"));
    expect(await count(db, "select 1 from public.requisitions")).toBe(20);
    expect(await statusOf(db, "partially_approved")).toBe("partially_approved");
  });

  it("reset partially_approved restores it without touching other scenarios, and re-seeding creates no duplicate", async () => {
    const before = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:partially_approved'");
    const total = await count(db, "select 1 from public.requisitions");
    await db.exec(sql("seed_training.sql", "partially_approved"));
    expect(await count(db, "select 1 from public.requisitions where submission_fingerprint = 'training:partially_approved'")).toBe(1);
    await db.exec(sql("reset_scenarios.sql", "partially_approved"));
    expect(await count(db, "select 1 from public.requisitions")).toBe(total - 1);
    await db.exec(sql("seed_training.sql", "partially_approved"));
    const after = await one<{ id: string }>(db, "select id from public.requisitions where submission_fingerprint = 'training:partially_approved'");
    expect(after.id).not.toBe(before.id);
    expect(await statusOf(db, "partially_approved")).toBe("partially_approved");
    expect(await count(db, "select 1 from public.requisitions")).toBe(total);
    expect(await count(db, "select 1 from public.requisitions where is_demo")).toBe(0);
  });
});
