/**
 * public.log_invitation_reissued: the only way invitation re-issues reach the
 * audit log. It accepts no URL or token, requires users.manage, and leaves the
 * profile and roles untouched. Reactivation is audited by profiles_audit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";

describe("invitation audit", () => {
  let db: Db;
  let admin: string;
  let viewer: string;
  let pending: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    admin = await createUser(db, "admin@example.org", ["administrator"]);
    viewer = await createUser(db, "viewer@example.org", ["viewer"]);
    pending = await createUser(db, "pending@example.org", ["requester"], "Pending Person");
  });

  const snapshot = async () => one<{ profile: string; roles: string; users: number; profiles: number }>(db, `
    select (select row(id, email, full_name, is_active)::text from public.profiles where id = $1) as profile,
           (select string_agg(role_id::text, ',' order by role_id) from public.user_roles where user_id = $1) as roles,
           (select count(*)::int from auth.users) as users,
           (select count(*)::int from public.profiles) as profiles`, [pending]);

  it.each([["email", "user.invitation_resent"], ["link", "user.invitation_link_replaced"]] as const)(
    "%s → %s, attributed to the manager, metadata holds only the delivery", async (delivery, action) => {
      const before = await snapshot();
      await as(db, "authenticated", admin, () => db.query("select public.log_invitation_reissued($1, $2)", [pending, delivery]));
      const row = await one<{ actor_id: string; entity_type: string; entity_id: string; before_data: unknown; after_data: unknown; metadata: unknown }>(db,
        "select actor_id, entity_type, entity_id, before_data, after_data, metadata from public.audit_logs where action = $1 order by occurred_at desc limit 1", [action]);
      expect(row).toEqual({ actor_id: admin, entity_type: "profile", entity_id: pending, before_data: null, after_data: null, metadata: { delivery } });
      expect(await snapshot()).toEqual(before);
    });

  it("requires users.manage", async () => {
    await expectError(as(db, "authenticated", viewer, () => db.query("select public.log_invitation_reissued($1, 'email')", [pending])), /permission denied/);
  });

  it("is not callable anonymously", async () => {
    await expectError(as(db, "anon", null, () => db.query("select public.log_invitation_reissued($1, 'email')", [pending])), /permission denied/);
  });

  it("rejects unknown deliveries and users", async () => {
    await expectError(as(db, "authenticated", admin, () => db.query("select public.log_invitation_reissued($1, 'https://x.invalid/?token=abc')", [pending])), /Invalid invitation delivery/);
    await expectError(as(db, "authenticated", admin, () => db.query("select public.log_invitation_reissued(gen_random_uuid(), 'email')")), /User not found/);
  });

  it("reactivation is already audited by the profiles trigger", async () => {
    await as(db, "authenticated", admin, () => db.query("update public.profiles set is_active = false where id = $1", [pending]));
    await as(db, "authenticated", admin, () => db.query("update public.profiles set is_active = true where id = $1", [pending]));
    const row = await one<{ actor_id: string; before_active: boolean; after_active: boolean }>(db,
      "select actor_id, (before_data->>'is_active')::boolean as before_active, (after_data->>'is_active')::boolean as after_active from public.audit_logs where entity_id = $1 and action = 'profile.updated' order by occurred_at desc, id desc limit 1", [pending]);
    expect(row).toEqual({ actor_id: admin, before_active: false, after_active: true });
  });
});
