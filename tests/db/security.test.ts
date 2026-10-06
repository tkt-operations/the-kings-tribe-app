import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { FORM_TOKEN, createFormToken, lookup, payload, submit } from "./fixtures";

let db: Db;
let adminId: string;
let financeHeadId: string;
let financeUserId: string;
let reportingId: string;
let viewerId: string;
let ids: Awaited<ReturnType<typeof lookup>>;

const SENSITIVE_TABLES = [
  "requisitions", "requisition_items", "finance_entries", "attendance_entries", "service_dates",
  "purchase_orders", "receipts", "receipt_files", "audit_logs", "profiles", "church_settings",
  "external_form_tokens", "departments", "categories", "notification_preferences", "inbound_emails",
  "disbursements", "vendor_orders", "user_roles", "rate_limit_events", "document_sequences",
];

beforeAll(async () => {
  db = await createTestDatabase();
  adminId = await createUser(db, "admin@example.org", ["administrator"]);
  financeHeadId = await createUser(db, "head@example.org", ["head_of_finance"]);
  financeUserId = await createUser(db, "fin@example.org", ["finance_user"]);
  reportingId = await createUser(db, "report@example.org", ["reporting_user"]);
  viewerId = await createUser(db, "viewer@example.org", ["viewer"]);
  ids = await lookup(db);
  await createFormToken(db);
  await submit(db, payload(ids));
});

describe("anonymous (external) access", () => {
  it.each(SENSITIVE_TABLES)("cannot read public.%s", async (table) => {
    await as(db, "anon", null, () => expectError(db.query(`select * from public.${table} limit 1`), /permission denied/));
  });

  it("cannot call internal or trusted functions", async () => {
    await as(db, "anon", null, async () => {
      await expectError(db.query("select public.submit_requisition('x', '{}'::jsonb, '[]'::jsonb, null)"), /permission denied/);
      await expectError(db.query("select public.review_requisition(gen_random_uuid(), 'approve')"), /permission denied/);
      await expectError(db.query("select public.my_permissions()"), /permission denied/);
      await expectError(db.query("select private.has_permission('finance.view')"), /permission denied/);
    });
  });

  it("gets form context only with a valid token, and no financial data", async () => {
    await as(db, "anon", null, async () => {
      const bad = await one<{ r: unknown }>(db, "select public.get_request_form_context('not-a-real-token-000000000000000000') as r");
      expect(bad.r).toBeNull();
      const good = await one<{ r: Record<string, unknown> }>(db, "select public.get_request_form_context($1) as r", [FORM_TOKEN]);
      expect(Object.keys(good.r).sort()).toEqual(
        ["church", "cost_centers", "currency", "departments", "policy", "request_types", "restricted_department_id", "timezone", "today"].sort(),
      );
      expect(JSON.stringify(good.r)).not.toMatch(/TKT-REQ|estimated_total|approved_total|requester_email/);
    });
  });

  it("revoked or expired tokens stop working", async () => {
    const token = "revoked-token-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    const tokenId = await createFormToken(db, token);
    await db.query("update public.external_form_tokens set revoked_at = now(), is_active = false where id = $1", [tokenId]);
    await as(db, "anon", null, async () => {
      const r = await one<{ r: unknown }>(db, "select public.get_request_form_context($1) as r", [token]);
      expect(r.r).toBeNull();
    });
    await expectError(submit(db, payload(ids), [], token), /invalid or has expired/);
  });

  it("department-locked links reject other departments", async () => {
    const token = "locked-token-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";
    await createFormToken(db, token, ids.deptId);
    await expectError(
      submit(db, payload(ids, { department_id: ids.otherDeptId, subcategory_id: ids.otherSubId }), [], token),
      /assigned department/,
    );
  });
});

describe("internal roles and RLS", () => {
  async function count(userId: string, table: string): Promise<number> {
    return as(db, "authenticated", userId, async () => {
      const r = await one<{ n: number }>(db, `select count(*)::int as n from public.${table}`);
      return r.n;
    });
  }

  it("requisitions are visible to finance head and admin only", async () => {
    expect(await count(adminId, "requisitions")).toBe(1);
    expect(await count(financeHeadId, "requisitions")).toBe(1);
    expect(await count(financeUserId, "requisitions")).toBe(0);
    expect(await count(reportingId, "requisitions")).toBe(0);
    expect(await count(viewerId, "requisitions")).toBe(0);
  });

  it("an authenticated user with no roles/profile activity sees nothing", async () => {
    const { id } = await one<{ id: string }>(db, "insert into auth.users (email) values ('nobody@example.org') returning id");
    expect(await count(id, "requisitions")).toBe(0);
    expect(await count(id, "church_settings")).toBe(1); // has a profile => internal; but no permissions
    await db.query("update public.profiles set is_active = false where id = $1", [id]);
    expect(await count(id, "church_settings")).toBe(0);
    expect(await count(id, "categories")).toBe(0);
  });

  it("permissions are reported per role", async () => {
    const perms = await as(db, "authenticated", financeUserId, async () =>
      (await one<{ p: string[] }>(db, "select public.my_permissions() as p")).p,
    );
    expect(perms).toEqual(["dashboard.view", "finance.enter", "finance.view"]);
    const adminPerms = await as(db, "authenticated", adminId, async () =>
      (await one<{ p: string[] }>(db, "select public.my_permissions() as p")).p,
    );
    expect(adminPerms).toContain("users.manage");
  });

  it("workflow writes require the right permission", async () => {
    const req = await one<{ id: string }>(db, "select id from public.requisitions limit 1");
    await as(db, "authenticated", financeUserId, () =>
      expectError(db.query("select public.review_requisition($1, 'approve')", [req.id]), /permission denied: requisitions.review/),
    );
    await as(db, "authenticated", viewerId, () =>
      expectError(db.query("select public.save_sunday_entry(current_date, 'Sunday Service', null, '[]'::jsonb)"), /permission denied: finance.enter/),
    );
  });

  it("direct table writes on financial data are not possible", async () => {
    await as(db, "authenticated", adminId, async () => {
      await expectError(db.query("update public.requisitions set approved_total = 999"), /permission denied/);
      await expectError(db.query("delete from public.requisitions"), /permission denied/);
      await expectError(
        db.query("insert into public.finance_entries (service_date_id, category_id, amount) values (gen_random_uuid(), gen_random_uuid(), 1)"),
        /permission denied/,
      );
    });
  });

  it("configuration writes follow permissions", async () => {
    await as(db, "authenticated", reportingId, () =>
      expectError(db.query("insert into public.categories (type, name) values ('attendance', 'Youth')"), /row-level security/),
    );
    await as(db, "authenticated", adminId, async () => {
      await db.query("insert into public.categories (type, name) values ('attendance', 'Youth')");
      await expectError(db.query("delete from public.categories where name = 'Youth'"), /permission denied/);
    });
  });

  it("audit logs are append-only, even for administrators", async () => {
    await as(db, "authenticated", adminId, async () => {
      const r = await one<{ n: number }>(db, "select count(*)::int as n from public.audit_logs");
      expect(r.n).toBeGreaterThan(0);
      await expectError(db.query("update public.audit_logs set action = 'x'"), /permission denied/);
      await expectError(db.query("delete from public.audit_logs"), /permission denied/);
    });
    // Even the table owner cannot rewrite history.
    await expectError(db.query("update public.audit_logs set action = 'x'"), /append-only/);
  });

  it("users cannot re-activate or deactivate themselves without users.manage", async () => {
    await as(db, "authenticated", financeUserId, async () => {
      await db.query("update public.profiles set full_name = 'Finance Person' where id = $1", [financeUserId]);
      await expectError(db.query("update public.profiles set is_active = false where id = $1", [financeUserId]), /users.manage/);
    });
  });

  it("the last administrator cannot be removed", async () => {
    await as(db, "authenticated", adminId, () =>
      expectError(
        db.query("delete from public.user_roles where user_id = $1", [adminId]),
        /last active administrator/,
      ),
    );
  });

  it("storage policies keep receipts private and scoped", async () => {
    await as(db, "anon", null, () => expectError(db.query("select * from storage.objects"), /permission denied/));
    await as(db, "authenticated", viewerId, async () => {
      await expectError(
        db.query("insert into storage.objects (bucket_id, name) values ('receipts', 'requisitions/x/a.pdf')"),
        /row-level security/,
      );
    });
    await as(db, "authenticated", financeHeadId, async () => {
      await db.query("insert into storage.objects (bucket_id, name) values ('receipts', 'requisitions/x/a.pdf')");
      await expectError(
        db.query("insert into storage.objects (bucket_id, name) values ('receipts', 'requisitions/x/a.exe')"),
        /row-level security/,
      );
      await expectError(
        db.query("insert into storage.objects (bucket_id, name) values ('receipts', 'external/x/a.pdf')"),
        /row-level security/,
      );
    });
    const buckets = await db.query<{ id: string; public: boolean }>("select id, public from storage.buckets order by id");
    expect(buckets.rows).toEqual([
      { id: "purchase-orders", public: false },
      { id: "receipts", public: false },
    ]);
  });
});
