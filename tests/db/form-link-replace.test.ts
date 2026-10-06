/**
 * Database effects of "Replace link" exactly as the server action issues them
 * (insert new hashed row, then revoke the old row) — as an administrator under RLS.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, one, type Db } from "./harness";
import { lookup, sha256Hex } from "./fixtures";

const OLD = "old-token-abcdefghijklmnopqrstuvwxyz-0123456789AB";
const NEW = "new-token-ZYXWVUTSRQPONMLKJIHGFEDCBA-9876543210zz";

let db: Db;
let admin: string;
let viewer: string;
let oldId: string;
let deptId: string;

async function formContext(token: string) {
  return as(db, "anon", null, async () => (await one<{ c: unknown }>(db, "select public.get_request_form_context($1) as c", [token])).c);
}

beforeAll(async () => {
  db = await createTestDatabase();
  admin = await createUser(db, "admin@example.org", ["administrator"]);
  viewer = await createUser(db, "viewer@example.org", ["viewer"]);
  deptId = (await lookup(db)).deptId;
  oldId = (await as(db, "authenticated", admin, () => one<{ id: string }>(db,
    `insert into public.external_form_tokens (label, token_hash, token_hint, department_id, expires_at, max_submissions, created_by)
     values ('Production Team', $1, $2, $3, now() + interval '30 days', 25, $4) returning id`,
    [sha256Hex(OLD), OLD.slice(0, 6), deptId, admin]))).id;
});

describe("replace link", () => {
  it("before replacement the old URL works", async () => {
    expect(await formContext(OLD)).not.toBeNull();
  });

  it("users without form_links.manage cannot create or revoke links", async () => {
    await expect(as(db, "authenticated", viewer, () => db.query(
      "insert into public.external_form_tokens (label, token_hash, token_hint, created_by) values ('x', $1, 'abcdef', $2)", [sha256Hex("z".repeat(40)), viewer],
    ))).rejects.toThrow(/row-level security/);
    const r = await as(db, "authenticated", viewer, () => db.query("update public.external_form_tokens set revoked_at = now() where id = $1 returning id", [oldId]));
    expect(r.rows).toHaveLength(0);
    expect(await formContext(OLD)).not.toBeNull();
  });

  it("creates the new link with the same configuration, then revokes the old", async () => {
    const old = await one<{ label: string; department_id: string; expires_at: string; max_submissions: number }>(db,
      "select label, department_id, expires_at::text, max_submissions from public.external_form_tokens where id = $1", [oldId]);
    await as(db, "authenticated", admin, async () => {
      await db.query(
        `insert into public.external_form_tokens (label, token_hash, token_hint, department_id, expires_at, max_submissions, created_by)
         values ($1, $2, $3, $4, $5::timestamptz, $6, $7)`,
        [old.label, sha256Hex(NEW), NEW.slice(0, 6), old.department_id, old.expires_at, old.max_submissions, admin],
      );
      await db.query("update public.external_form_tokens set is_active = false, revoked_at = now(), revoked_by = $2 where id = $1", [oldId, admin]);
    });
    const fresh = await one<{ label: string; department_id: string; max_submissions: number; same_expiry: boolean; submission_count: number }>(db,
      `select n.label, n.department_id, n.max_submissions, n.expires_at = o.expires_at as same_expiry, n.submission_count
       from public.external_form_tokens n, public.external_form_tokens o where n.token_hash = $1 and o.id = $2`, [sha256Hex(NEW), oldId]);
    expect(fresh).toEqual({ label: "Production Team", department_id: deptId, max_submissions: 25, same_expiry: true, submission_count: 0 });
  });

  it("the old URL stops working and the new URL works", async () => {
    expect(await formContext(OLD)).toBeNull();
    const ctx = (await formContext(NEW)) as { restricted_department_id: string } | null;
    expect(ctx).not.toBeNull();
    expect(ctx!.restricted_department_id).toBe(deptId);
  });

  it("is audited (who and when) without storing any raw token or hash", async () => {
    const rows = await db.query<{ action: string; actor_id: string; occurred_at: string; before_data: unknown; after_data: unknown }>(
      "select action, actor_id, occurred_at, before_data, after_data from public.audit_logs where entity_type = 'external_form_token' order by occurred_at",
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["external_form_token.created", "external_form_token.updated"]));
    expect(rows.rows.every((r) => r.actor_id === admin && r.occurred_at)).toBe(true);
    const revoke = rows.rows.find((r) => r.action === "external_form_token.updated")!;
    expect(revoke.after_data).toMatchObject({ is_active: false, revoked_by: admin });
    const dump = JSON.stringify(rows.rows);
    for (const secret of [OLD, NEW, sha256Hex(OLD), sha256Hex(NEW)]) expect(dump).not.toContain(secret);
  });
});
