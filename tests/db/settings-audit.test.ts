/**
 * Root cause of the setup wizard failures: auditing church_settings updates
 * cast its smallint id (1) to uuid, so every settings save rolled back.
 * Migration 20261006000050 fixes the audit trigger.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const FIX = "20261006000050_fix_singleton_settings_audit.sql";
const SAVE = "update public.church_settings set church_name = $1, address_line1 = '100 Example Ave', phone = '(555) 010-0000', email = 'office@example.org', updated_by = auth.uid() where id = 1 returning id";

describe("before the fix (reproduces the production error)", () => {
  it("every church_settings update fails with 22P02", async () => {
    const db = await createTestDatabase({ before: FIX });
    const admin = await createUser(db, "admin@example.org", ["administrator"]);
    await expectError(as(db, "authenticated", admin, () => db.query(SAVE, ["Kings Tribe"])), /invalid input syntax for type uuid: "1"/);
  });
});

describe("after the fix", () => {
  let db: Db;
  let admin: string;
  let viewer: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await createUser(db, "admin@example.org", ["administrator"]);
    viewer = await createUser(db, "viewer@example.org", ["viewer"]);
  });

  it("an administrator can save church information, and it persists", async () => {
    const r = await as(db, "authenticated", admin, () => db.query(SAVE, ["The Kings Tribe Church"]));
    expect(r.rows).toHaveLength(1);
    // Read back independently of the session that wrote it.
    const row = await one<{ church_name: string; address_line1: string; phone: string; email: string; updated_by: string }>(
      db, "select church_name, address_line1, phone, email, updated_by from public.church_settings where id = 1",
    );
    expect(row).toEqual({ church_name: "The Kings Tribe Church", address_line1: "100 Example Ave", phone: "(555) 010-0000", email: "office@example.org", updated_by: admin });
  });

  it("is still audited, keeping the singleton key in metadata", async () => {
    const audit = await one<{ entity_id: string | null; actor_id: string; metadata: { row_key?: string }; after_data: { church_name: string } }>(
      db,
      "select entity_id, actor_id, metadata, after_data from public.audit_logs where action = 'church_settings.updated' order by occurred_at desc limit 1",
    );
    expect(audit).toMatchObject({ entity_id: null, actor_id: admin, metadata: { row_key: "1" }, after_data: { church_name: "The Kings Tribe Church" } });
  });

  it("'Mark setup complete' can be saved", async () => {
    await as(db, "authenticated", admin, () => db.query("update public.church_settings set setup_completed_at = now() where id = 1"));
    const row = await one<{ done: boolean }>(db, "select setup_completed_at is not null as done from public.church_settings");
    expect(row.done).toBe(true);
  });

  it("other audited tables keep their uuid entity ids", async () => {
    const cat = await one<{ id: string }>(db, "select id from public.categories where type = 'finance' limit 1");
    await as(db, "authenticated", admin, () => db.query("update public.categories set name = name || ' (renamed)' where id = $1", [cat.id]));
    const audit = await one<{ entity_id: string; metadata: Record<string, unknown> }>(
      db, "select entity_id, metadata from public.audit_logs where action = 'category.updated' order by occurred_at desc limit 1",
    );
    expect(audit).toEqual({ entity_id: cat.id, metadata: {} });
  });

  it("users without settings.manage still cannot change settings (RLS unchanged)", async () => {
    const r = await as(db, "authenticated", viewer, () => db.query("update public.church_settings set church_name = 'Hacked' where id = 1 returning id"));
    expect(r.rows).toHaveLength(0);
    expect((await one<{ church_name: string }>(db, "select church_name from public.church_settings")).church_name).toBe("The Kings Tribe Church");
  });

  it("applies to an existing installation without touching its data", async () => {
    const legacy = await createTestDatabase({ before: FIX });
    await legacy.query("update public.categories set name = 'Sunday Offering' where name = 'Offering'");
    const before = await legacy.query("select * from public.church_settings");
    await applyMigrationsFrom(legacy, FIX);
    const after = await legacy.query("select * from public.church_settings");
    expect(after.rows).toEqual(before.rows);
    expect((await legacy.query("select 1 from public.categories where name = 'Sunday Offering'")).rows).toHaveLength(1);
  });
});
