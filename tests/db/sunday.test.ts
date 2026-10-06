import { beforeAll, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";

let db: Db;
let financeId: string;
let reportingId: string;
let adminId: string;
let cat: Record<string, string>;
let today: string;

beforeAll(async () => {
  db = await createTestDatabase();
  adminId = await createUser(db, "admin@example.org", ["administrator"]);
  financeId = await createUser(db, "fin@example.org", ["finance_user"]);
  reportingId = await createUser(db, "rep@example.org", ["reporting_user"]);
  const rows = await db.query<{ id: string; name: string }>("select id, name from public.categories");
  cat = Object.fromEntries(rows.rows.map((r) => [r.name, r.id]));
  today = (await one<{ d: string }>(db, "select private.church_today()::text as d")).d;
});

async function save(userId: string, attendance: unknown, finance: unknown, date = today) {
  return as(db, "authenticated", userId, async () =>
    (await one<{ r: { attendance_total: number; finance_total: string; service_date_id: string } }>(
      db,
      "select public.save_sunday_entry($1::date, 'Sunday Service', $2::jsonb, $3::jsonb) as r",
      [date, attendance === null ? null : JSON.stringify(attendance), finance === null ? null : JSON.stringify(finance)],
    )).r,
  );
}

describe("Sunday Entry", () => {
  it("saves attendance and calculates the total across categories", async () => {
    const r = await save(reportingId, [
      { category_id: cat["Adult Church"], count: "142" },
      { category_id: cat["Children's Church"], count: "38" },
    ], null);
    expect(r.attendance_total).toBe(180);
  });

  it("supports admin-added attendance categories (not hard-coded)", async () => {
    await as(db, "authenticated", adminId, () =>
      db.query("insert into public.categories (type, name, sort_order) values ('attendance', 'Youth', 30)"),
    );
    const youth = (await one<{ id: string }>(db, "select id from public.categories where name = 'Youth'")).id;
    const r = await save(reportingId, [{ category_id: youth, count: "21" }], null);
    expect(r.attendance_total).toBe(201);
  });

  it("saves finance with exact decimal totals", async () => {
    const r = await save(financeId, null, [
      { category_id: cat["Offering"], amount: "1234.56" },
      { category_id: cat["Tithe"], amount: "0.10" },
      { category_id: cat["Church Outreach"], amount: "0.20" },
    ]);
    expect(r.finance_total).toBe("1234.86");
  });

  it("separates attendance and finance permissions", async () => {
    await as(db, "authenticated", financeId, () =>
      expectError(db.query("select public.save_sunday_entry($1::date, 'Sunday Service', '[]'::jsonb, null)", [today]), /attendance.enter/),
    );
    await as(db, "authenticated", reportingId, () =>
      expectError(db.query("select public.save_sunday_entry($1::date, 'Sunday Service', null, '[]'::jsonb)", [today]), /finance.enter/),
    );
  });

  it("rejects negatives except for adjustment categories, and bad precision", async () => {
    await expectError(save(financeId, null, [{ category_id: cat["Offering"], amount: "-5.00" }]), /cannot be negative/);
    await expectError(save(financeId, null, [{ category_id: cat["Offering"], amount: "5.001" }]), /2 decimal places/);
    await expectError(save(reportingId, [{ category_id: cat["Adult Church"], count: "-1" }], null), /whole numbers/);
    await as(db, "authenticated", adminId, () =>
      db.query("insert into public.categories (type, name, allows_negative, sort_order) values ('finance', 'Adjustments', true, 90)"),
    );
    const adj = (await one<{ id: string }>(db, "select id from public.categories where name = 'Adjustments'")).id;
    const r = await save(financeId, null, [{ category_id: adj, amount: "-34.86" }]);
    expect(r.finance_total).toBe("1200.00");
  });

  it("edits are audited with before/after values and clearing voids the entry", async () => {
    await save(financeId, null, [{ category_id: cat["Offering"], amount: "1300.00" }]);
    const audit = await one<{ before: string; after: string }>(
      db,
      `select before_data->>'amount' as before, after_data->>'amount' as after from public.audit_logs
       where action = 'finance_entry.updated' and before_data->>'amount' = '1234.56' order by occurred_at desc limit 1`,
    );
    expect(audit).toEqual({ before: "1234.56", after: "1300.00" });
    const r = await save(financeId, null, [{ category_id: cat["Tithe"], amount: "" }]);
    expect(r.finance_total).toBe("1265.34");
    const voided = await one<{ void_reason: string }>(
      db, "select void_reason from public.finance_entries where category_id = $1 and voided_at is not null", [cat["Tithe"]]);
    expect(voided.void_reason).toBe("Cleared in Sunday Entry");
  });

  it("archived categories cannot receive new entries", async () => {
    await as(db, "authenticated", adminId, () =>
      db.query("update public.categories set is_active = false where id = $1", [cat["Church Outreach"]]),
    );
    const yesterday = (await one<{ d: string }>(db, "select (private.church_today() - 7)::text as d")).d;
    await expectError(save(financeId, null, [{ category_id: cat["Church Outreach"], amount: "10" }], yesterday), /archived/);
  });

  it("rejects future service dates", async () => {
    const future = (await one<{ d: string }>(db, "select (private.church_today() + 30)::text as d")).d;
    await expectError(save(reportingId, [{ category_id: cat["Adult Church"], count: "1" }], null, future), /valid service date/);
  });

  it("service_category_totals respects RLS per bucket", async () => {
    const forFinance = await as(db, "authenticated", financeId, async () =>
      (await db.query<{ kind: string }>("select kind from public.service_category_totals($1::date - 30, $1::date)", [today])).rows);
    expect(new Set(forFinance.map((r) => r.kind))).toEqual(new Set(["finance"]));
    const forReporting = await as(db, "authenticated", reportingId, async () =>
      (await db.query<{ kind: string }>("select kind from public.service_category_totals($1::date - 30, $1::date)", [today])).rows);
    expect(new Set(forReporting.map((r) => r.kind))).toEqual(new Set(["attendance"]));
  });
});
