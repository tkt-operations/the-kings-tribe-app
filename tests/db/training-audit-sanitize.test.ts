/**
 * supabase/training/sanitize_training_audit.sql and verify_audit_protection.sql,
 * run against the real migrations in PGlite (local only — never a remote database).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTestDatabase, expectError, one, type Db } from "./harness";

const DIR = path.join(process.cwd(), "supabase", "training");
const verifySql = readFileSync(path.join(DIR, "verify_audit_protection.sql"), "utf8");
const sanitizeFile = readFileSync(path.join(DIR, "sanitize_training_audit.sql"), "utf8");
/** The committed file targets the training project's four row ids; tests substitute their own. */
const sanitizeSql = (ids: string[]) =>
  sanitizeFile.replace(/v_ids uuid\[\] := array\[[\s\S]*?\]::uuid\[\];/, `v_ids uuid[] := array[${ids.map((id) => `'${id}'`).join(", ")}]::uuid[];`);

const count = async (db: Db, sql: string) => Number((await one<{ n: string }>(db, `select count(*) as n from (${sql}) q`)).n);
const triggerEnabled = async (db: Db) =>
  (await one<{ e: string }>(db, "select tgenabled::text as e from pg_trigger where tgrelid = 'public.audit_logs'::regclass and tgname = 'audit_logs_no_update'")).e === "O";

/** A training database whose audit history recorded a real-looking address before the fictional values were set. */
async function pollutedTrainingDatabase() {
  const db = await createTestDatabase();
  await db.query("update public.church_settings set church_name = 'The Kings Tribe (TRAINING)' where id = 1");
  await db.query("update public.church_settings set email = 'office@thekingstribe.org', phone = '2145559999' where id = 1");
  await db.query("update public.church_settings set email = 'training@demo.invalid', phone = '2145550100' where id = 1");
  const polluted = (await db.query<{ id: string }>("select id from public.audit_logs a where a::text ilike '%thekingstribe.org%' order by occurred_at")).rows.map((r) => r.id);
  return { db, polluted };
}

describe("verify_audit_protection.sql", () => {
  it("passes when the trigger is enabled, refusing an ordinary delete and update, and changes nothing", async () => {
    const { db } = await pollutedTrainingDatabase();
    const before = await count(db, "select * from public.audit_logs");
    await db.exec(verifySql);
    expect(await count(db, "select * from public.audit_logs")).toBe(before);
    await expectError(db.query("delete from public.audit_logs"), /append-only/);
  });

  it("fails when the protection is disabled, and still changes nothing", async () => {
    const { db } = await pollutedTrainingDatabase();
    const before = await count(db, "select * from public.audit_logs");
    await db.exec("alter table public.audit_logs disable trigger audit_logs_no_update");
    await expectError(db.exec(verifySql), /trigger is missing or disabled/);
    expect(await count(db, "select * from public.audit_logs")).toBe(before);
  });
});

describe("sanitize_training_audit.sql", () => {
  it("deletes only the listed rows, keeps every other audit row and restores append-only protection", async () => {
    const { db, polluted } = await pollutedTrainingDatabase();
    expect(polluted).toHaveLength(2);
    const others = (await db.query<{ id: string }>("select id from public.audit_logs where not (id = any($1::uuid[])) order by id", [polluted])).rows;
    await db.exec(sanitizeSql(polluted));
    expect(await count(db, "select 1 from public.audit_logs a where a::text ilike '%thekingstribe.org%' or a::text like '%2145559999%'")).toBe(0);
    expect((await db.query<{ id: string }>("select id from public.audit_logs order by id")).rows).toEqual(others);
    expect(await triggerEnabled(db)).toBe(true);
    await expectError(db.query("delete from public.audit_logs"), /append-only/);
    await db.exec(verifySql);
  });

  it.each([
    ["the church name lacks TRAINING", "update public.church_settings set church_name = 'The Kings Tribe' where id = 1", /TRAINING GUARD: refusing/],
    ["the live church email is not the fictional one", "update public.church_settings set email = 'office@example.org' where id = 1", /church email is not the fictional/],
  ])("refuses and changes nothing when %s", async (_label, setup, message) => {
    const { db, polluted } = await pollutedTrainingDatabase();
    await db.query(setup);
    const before = await count(db, "select * from public.audit_logs");
    await expectError(db.exec(sanitizeSql(polluted)), message);
    expect(await count(db, "select * from public.audit_logs")).toBe(before);
    expect(await triggerEnabled(db)).toBe(true);
  });

  it("refuses when an unlisted row also matches, or a listed row no longer matches", async () => {
    const { db, polluted } = await pollutedTrainingDatabase();
    const before = await count(db, "select * from public.audit_logs");
    await expectError(db.exec(sanitizeSql(polluted.slice(0, 1))), /Expected exactly 1 matching rows, all listed; found 1 listed and 2 in total/);
    const unrelated = (await one<{ id: string }>(db, "select id from public.audit_logs a where not (a::text ilike '%thekingstribe.org%') limit 1")).id;
    await expectError(db.exec(sanitizeSql([polluted[0], unrelated])), /found 1 listed and 2 in total/);
    expect(await count(db, "select * from public.audit_logs")).toBe(before);
    expect(await triggerEnabled(db)).toBe(true);
  });

  it("is a no-op refusal when run a second time", async () => {
    const { db, polluted } = await pollutedTrainingDatabase();
    await db.exec(sanitizeSql(polluted));
    await expectError(db.exec(sanitizeSql(polluted)), /found 0 listed and 0 in total/);
    expect(await triggerEnabled(db)).toBe(true);
  });

  it("the committed file targets exactly the four identified training rows", () => {
    const ids = sanitizeFile.match(/v_ids uuid\[\] := array\[([\s\S]*?)\]::uuid\[\];/)![1].match(/'[0-9a-f-]{36}'/g);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
