import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, createUser, one, type Db } from "./harness";

let db: Db;
const load = readFileSync(path.join(process.cwd(), "supabase/demo/load_demo_data.sql"), "utf8");
const remove = readFileSync(path.join(process.cwd(), "supabase/demo/remove_demo_data.sql"), "utf8");

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("demo data", () => {
  it("refuses to load before an administrator exists", async () => {
    await expect(db.exec(load)).rejects.toThrow(/first administrator/);
  });

  it("loads one requisition in every status, plus Sundays, without touching real data", async () => {
    await createUser(db, "admin@example.org", ["administrator"]);
    // A real Sunday that must survive
    const { id: sd } = await one<{ id: string }>(db, "insert into public.service_dates (service_date) values (private.church_today() - 400) returning id");
    await db.exec(load);
    const statuses = await db.query<{ status: string }>("select distinct status from public.requisitions where is_demo order by 1");
    expect(statuses.rows.map((r) => r.status).sort()).toEqual(
      ["approved", "closed", "on_hold", "ordered", "partially_approved", "partially_purchased", "po_issued", "purchased", "rejected", "submitted", "under_review"].sort(),
    );
    const sundays = await one<{ n: number }>(db, "select count(*)::int as n from public.service_dates where is_demo");
    expect(sundays.n).toBe(12);
    const pos = await one<{ n: number }>(db, "select count(*)::int as n from public.purchase_orders where is_demo");
    expect(pos.n).toBe(3);
    const nonDemo = await one<{ n: number }>(db, "select count(*)::int as n from public.service_dates where id = $1 and not is_demo", [sd]);
    expect(nonDemo.n).toBe(1);
  });

  it("removes every demo row and keeps real data", async () => {
    await db.exec(remove);
    for (const table of ["requisitions", "purchase_orders", "vendor_orders", "receipts", "disbursements", "service_dates", "finance_entries", "attendance_entries"]) {
      const r = await one<{ n: number }>(db, `select count(*)::int as n from public.${table} where is_demo`);
      expect(r.n, table).toBe(0);
    }
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.service_dates")).n).toBe(1);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.document_sequences")).n).toBe(0);
  });
});
