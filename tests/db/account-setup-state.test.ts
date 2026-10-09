/**
 * profiles.account_setup_completed_at: the app's own record that a person
 * chose a password. Supabase's email_confirmed_at / last_sign_in_at are set the
 * moment an invitation link is opened, so they cannot answer that question.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const MIGRATION = "20261012000100_account_setup_state.sql";
const setupAt = async (db: Db, id: string) =>
  (await one<{ at: string | null }>(db, "select account_setup_completed_at as at from public.profiles where id = $1", [id])).at;

describe("backfill marks only provable completions", () => {
  let db: Db;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDatabase({ before: MIGRATION });
    const user = async (key: string, sql: string) => {
      ids[key] = await createUser(db, `${key}@example.org`, ["viewer"]);
      await db.query(sql, [ids[key]]);
    };
    // First administrator from /setup: created with a password, never invited.
    await user("founder", "update auth.users set encrypted_password = 'hash', email_confirmed_at = now(), last_sign_in_at = now() where id = $1");
    // Invited, never opened.
    await user("unopened", "update auth.users set invited_at = now() where id = $1");
    // Invited, opened the link: Supabase confirmed them, set a random password and signed them in (otp session).
    await user("opened", "update auth.users set invited_at = now(), encrypted_password = 'random', email_confirmed_at = now(), last_sign_in_at = now() where id = $1");
    await db.query("with s as (insert into auth.sessions (user_id) values ($1) returning id) insert into auth.mfa_amr_claims (session_id, authentication_method) select id, 'otp' from s", [ids.opened]);
    // Same as "opened", plus a recovery session (the affected production case).
    await user("recovered", "update auth.users set invited_at = now(), encrypted_password = 'random', email_confirmed_at = now(), last_sign_in_at = now() where id = $1");
    await db.query("with s as (insert into auth.sessions (user_id) values ($1) returning id) insert into auth.mfa_amr_claims (session_id, authentication_method) select id, 'recovery' from s", [ids.recovered]);
    // Invited, and has since signed in with a password: provable.
    await user("signedIn", "update auth.users set invited_at = now(), encrypted_password = 'chosen', email_confirmed_at = now(), last_sign_in_at = now() where id = $1");
    await db.query("with s as (insert into auth.sessions (user_id) values ($1) returning id) insert into auth.mfa_amr_claims (session_id, authentication_method) select id, 'password' from s", [ids.signedIn]);
    await applyMigrationsFrom(db, MIGRATION);
  });

  it.each([
    ["founder", true],
    ["unopened", false],
    ["opened", false],
    ["recovered", false],
    ["signedIn", true],
  ])("%s → complete: %s", async (key, complete) => {
    expect((await setupAt(db, ids[key])) !== null).toBe(complete);
  });

  it("the backfill does not touch is_active, roles or audit history", async () => {
    const r = await one<{ inactive: number; roles: number; audits: number }>(db, `
      select (select count(*)::int from public.profiles where not is_active) as inactive,
             (select count(*)::int from public.user_roles) as roles,
             (select count(*)::int from public.audit_logs where action = 'user.account_setup_completed') as audits`);
    expect(r).toEqual({ inactive: 0, roles: 5, audits: 0 });
  });
});

describe("marking setup complete", () => {
  let db: Db;
  let admin: string;
  let invitee: string;
  let other: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await createUser(db, "admin@example.org", ["administrator"]);
    invitee = await createUser(db, "invitee@example.org", ["viewer"]);
    other = await createUser(db, "other@example.org", ["viewer"]);
  });

  it("a new invitee starts pending even when Supabase says confirmed and signed in", async () => {
    await db.query("update auth.users set invited_at = now(), email_confirmed_at = now(), last_sign_in_at = now() where id = $1", [invitee]);
    expect(await setupAt(db, invitee)).toBeNull();
  });

  it("the signed-in user marks only themselves; audited without secrets", async () => {
    const at = await as(db, "authenticated", invitee, () => db.query<{ at: string }>("select public.mark_account_setup_complete('password_set') as at"));
    expect(at.rows[0].at).not.toBeNull();
    expect(await setupAt(db, invitee)).not.toBeNull();
    expect(await setupAt(db, other)).toBeNull();
    const audit = await one<{ actor_id: string; entity_id: string; metadata: unknown; before_data: unknown; after_data: unknown }>(db,
      "select actor_id, entity_id, metadata, before_data, after_data from public.audit_logs where action = 'user.account_setup_completed'");
    expect(audit).toEqual({ actor_id: invitee, entity_id: invitee, metadata: { method: "password_set" }, before_data: null, after_data: null });
  });

  it("is idempotent: a later password sign-in keeps the original time and adds no audit row", async () => {
    const first = await setupAt(db, invitee);
    await as(db, "authenticated", invitee, () => db.query("select public.mark_account_setup_complete('password_sign_in')"));
    expect(await setupAt(db, invitee)).toEqual(first);
    const n = await one<{ n: number }>(db, "select count(*)::int as n from public.audit_logs where action = 'user.account_setup_completed'");
    expect(n.n).toBe(1);
  });

  it("cannot be set or cleared by a direct profile update — not by the user, not by an administrator", async () => {
    // Layer 1: authenticated has no UPDATE grant on the column.
    await expectError(as(db, "authenticated", other, () => db.query("update public.profiles set account_setup_completed_at = now() where id = $1", [other])), /permission denied/);
    await expectError(as(db, "authenticated", admin, () => db.query("update public.profiles set account_setup_completed_at = now() where id = $1", [other])), /permission denied/);
    await expectError(as(db, "authenticated", admin, () => db.query("update public.profiles set account_setup_completed_at = null where id = $1", [invitee])), /permission denied/);
    expect(await setupAt(db, other)).toBeNull();
  });

  it("layer 2: the guard trigger refuses any signed-in update outside the function, even with table privileges", async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    try {
      await expectError(db.query("update public.profiles set account_setup_completed_at = now() where id = $1", [other]), /permission denied: account setup state/);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub', '', false)");
    }
  });

  it("the setting that unlocks the column is cleared before the function returns", async () => {
    await as(db, "authenticated", other, async () => {
      await db.exec("begin");
      try {
        await db.query("select public.mark_account_setup_complete('password_set')");
        const v = await one<{ v: string | null }>(db, "select current_setting('app.account_setup_marking', true) as v");
        expect(v.v ?? "").toBe("");
        await expectError(db.query("update public.profiles set account_setup_completed_at = null where id = $1", [other]), /permission denied/);
      } finally {
        await db.exec("rollback");
      }
    });
  });

  it("users may still edit their own name; is_active stays manager-only", async () => {
    await as(db, "authenticated", other, () => db.query("update public.profiles set full_name = 'Other Person' where id = $1", [other]));
    await expectError(as(db, "authenticated", other, () => db.query("update public.profiles set is_active = false where id = $1", [other])), /permission denied: users.manage/);
  });

  it("requires a session and a known method; anon cannot call it", async () => {
    await expectError(as(db, "authenticated", null, () => db.query("select public.mark_account_setup_complete('password_set')")), /permission denied/);
    await expectError(as(db, "anon", null, () => db.query("select public.mark_account_setup_complete('password_set')")), /permission denied/);
    await expectError(as(db, "authenticated", other, () => db.query("select public.mark_account_setup_complete('magic')")), /Invalid setup method/);
  });
});

describe("recovery-link audit", () => {
  let db: Db;
  let admin: string;
  let viewer: string;
  let invitee: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await createUser(db, "admin@example.org", ["administrator"]);
    viewer = await createUser(db, "viewer@example.org", ["viewer"]);
    invitee = await createUser(db, "invitee@example.org", ["viewer"]);
  });

  it.each([["email", "user.recovery_email_sent"], ["link", "user.recovery_link_created"]] as const)("%s → %s with only the delivery", async (delivery, action) => {
    await as(db, "authenticated", admin, () => db.query("select public.log_account_recovery_issued($1, $2)", [invitee, delivery]));
    const row = await one<{ actor_id: string; entity_id: string; metadata: unknown }>(db,
      "select actor_id, entity_id, metadata from public.audit_logs where action = $1", [action]);
    expect(row).toEqual({ actor_id: admin, entity_id: invitee, metadata: { delivery } });
  });

  it("requires users.manage, rejects anything but email/link", async () => {
    await expectError(as(db, "authenticated", viewer, () => db.query("select public.log_account_recovery_issued($1, 'email')", [invitee])), /permission denied/);
    await expectError(as(db, "anon", null, () => db.query("select public.log_account_recovery_issued($1, 'email')", [invitee])), /permission denied/);
    await expectError(as(db, "authenticated", admin, () => db.query("select public.log_account_recovery_issued($1, 'https://x.invalid/#access_token=abc')", [invitee])), /Invalid recovery delivery/);
  });

  it("minimum privileges on both new functions", async () => {
    const rows = await db.query<{ fn: string; anon: boolean; authenticated: boolean; public_role: boolean; definer: boolean }>(`
      select p.proname as fn, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
             exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_role, p.prosecdef as definer
      from pg_proc p where p.proname in ('mark_account_setup_complete', 'log_account_recovery_issued') order by 1`);
    expect(rows.rows).toEqual([
      { fn: "log_account_recovery_issued", anon: false, authenticated: true, public_role: false, definer: true },
      { fn: "mark_account_setup_complete", anon: false, authenticated: true, public_role: false, definer: true },
    ]);
  });
});
