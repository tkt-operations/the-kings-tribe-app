/**
 * supabase/training/remove_capture_requisition.sql — removes exactly one
 * form-submitted capture requisition (e.g. S53) and nothing else. PGlite only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const DIR = path.join(process.cwd(), "supabase", "training");
const seed = readFileSync(path.join(DIR, "seed_training.sql"), "utf8").replaceAll("__TRAINING_SCENARIO__", "all");
const removal = (n: string) => readFileSync(path.join(DIR, "remove_capture_requisition.sql"), "utf8").replaceAll("__CAPTURE_REQUISITION__", n);
const count = async (db: Db, sql: string) => Number((await one<{ n: string }>(db, `select count(*) as n from (${sql}) q`)).n);

/** Submits one request through a fresh link, the way the public form does (not a seeded scenario). */
async function submitCapture(db: Db, email = "jamie.carter@demo.invalid") {
  const token = "capture-" + "x".repeat(40);
  await db.query(`insert into public.external_form_tokens (label, token_hash, token_hint, is_active)
    values ('Training Requester Walkthrough', encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'captur', true)`, [token]);
  const ids = await one<{ type: string; dept: string; sub: string }>(db, `select (select id from public.request_types where key = 'order')::text as type,
    d.id::text as dept, (select s.id from public.department_subcategories s where s.department_id = d.id limit 1)::text as sub
    from public.departments d where d.name = 'Production Team'`);
  const r = await one<{ n: string }>(db, `select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, 'capture-fp') ->> 'requisition_number' as n`, [token, JSON.stringify({
    request_type_id: ids.type, department_id: ids.dept, subcategory_id: ids.sub, requester_name: "Jamie Carter", requester_email: email,
    requester_phone: "+1 312 555 0123", department_head_name: "Jamie Carter", needed_by: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10), budget_status: "yes",
    justification: "Equipment for the screenshot capture example.", certification_accepted: true, certification_name: "Jamie Carter",
    items: [{ description: "Wireless microphone system", quantity: "1", estimated_unit_price: "349.00", priority: "medium" }],
  })]);
  return r.n;
}

let db: Db;
beforeEach(async () => {
  db = await createTestDatabase();
  await db.query("update public.church_settings set church_name = 'The Kings Tribe (TRAINING)' where id = 1");
  await createUser(db, "morgan.ellis@training.invalid", ["administrator"], "Morgan Ellis");
  await createUser(db, "taylor.brooks@training.invalid", ["head_of_finance"], "Taylor Brooks");
  await createUser(db, "riley.chen@training.invalid", ["finance_user"], "Riley Chen");
  await createUser(db, "sam.patel@training.invalid", ["reporting_user"], "Sam Patel");
  await db.exec(seed);
});

describe("remove_capture_requisition.sql", () => {
  it("removes only the capture requisition and what hangs off it; seeded scenarios and the audit log are kept", async () => {
    const number = await submitCapture(db);
    const seeded = await db.query("select id, status::text from public.requisitions where submission_fingerprint like 'training:%' order by id");
    const audit = await count(db, "select 1 from public.audit_logs");
    expect(await count(db, "select 1 from public.user_notifications n join public.requisitions r on r.id = n.requisition_id where r.requisition_number = '" + number + "'")).toBeGreaterThan(0);
    await db.exec(removal(number));
    expect(await count(db, `select 1 from public.requisitions where requisition_number = '${number}'`)).toBe(0);
    expect((await db.query("select id, status::text from public.requisitions order by id")).rows).toEqual(seeded.rows);
    expect(await count(db, "select 1 from public.user_notifications where requisition_id is null and type like 'requisition.%'")).toBe(0);
    expect(await count(db, "select 1 from public.notification_preferences p left join public.requisitions r on r.id = p.requisition_id where r.id is null")).toBe(0);
    expect(await count(db, "select 1 from public.audit_logs")).toBeGreaterThanOrEqual(audit);
  });

  it.each([
    ["a seeded scenario", async () => (await one<{ n: string }>(db, "select requisition_number as n from public.requisitions where submission_fingerprint = 'training:review_take_2'")).n, /seeded training scenario/],
    ["an unknown number", async () => "TKT-REQ-2026-9999", /expected exactly one requisition/],
    ["a non-.invalid requester", async () => submitCapture(db, "someone@example.org"), /fictional \.invalid/],
  ])("refuses %s and removes nothing", async (_label, pick, message) => {
    const number = await pick();
    const before = await count(db, "select 1 from public.requisitions");
    await expectError(db.exec(removal(number)), message);
    expect(await count(db, "select 1 from public.requisitions")).toBe(before);
  });

  it("refuses outside a TRAINING database and when the placeholder is not filled in", async () => {
    const number = await submitCapture(db);
    await db.query("update public.church_settings set church_name = 'The Kings Tribe' where id = 1");
    await expectError(db.exec(removal(number)), /TRAINING GUARD/);
    await db.query("update public.church_settings set church_name = 'The Kings Tribe (TRAINING)' where id = 1");
    await expectError(db.exec(readFileSync(path.join(DIR, "remove_capture_requisition.sql"), "utf8")), /is not a requisition number/);
    expect(await count(db, `select 1 from public.requisitions where requisition_number = '${number}'`)).toBe(1);
  });
});
