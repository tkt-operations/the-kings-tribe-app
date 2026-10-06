import { createHash } from "node:crypto";
import { as, one, type Db } from "./harness";

export const FORM_TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz-0123456789";

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function createFormToken(db: Db, token = FORM_TOKEN, departmentId: string | null = null): Promise<string> {
  const row = await one<{ id: string }>(
    db,
    `insert into public.external_form_tokens (label, token_hash, token_hint, department_id)
     values ('Test link', $1, $2, $3) returning id`,
    [sha256Hex(token), token.slice(0, 6), departmentId],
  );
  return row.id;
}

export async function lookup(db: Db) {
  const rt = await db.query<{ id: string; key: string }>("select id, key from public.request_types");
  const types = Object.fromEntries(rt.rows.map((r) => [r.key, r.id])) as Record<string, string>;
  const dept = await one<{ id: string }>(db, "select id from public.departments where name = 'Hospitality Team'");
  const sub = await one<{ id: string }>(
    db,
    "select id from public.department_subcategories where department_id = $1 and name = 'Guest Experience'",
    [dept.id],
  );
  const otherDept = await one<{ id: string }>(db, "select id from public.departments where name = 'Production Team'");
  const otherSub = await one<{ id: string }>(
    db,
    "select id from public.department_subcategories where department_id = $1 limit 1",
    [otherDept.id],
  );
  return { types, deptId: dept.id, subId: sub.id, otherDeptId: otherDept.id, otherSubId: otherSub.id };
}

export function payload(ids: Awaited<ReturnType<typeof lookup>>, overrides: Record<string, unknown> = {}) {
  return {
    request_type_id: ids.types.order,
    department_id: ids.deptId,
    subcategory_id: ids.subId,
    cost_center_id: null,
    requester_name: "Jordan Example",
    requester_email: "Jordan@Example.org",
    requester_phone: "+1 (555) 010-2000",
    department_head_name: "Jordan Example",
    needed_by: daysFromNow(14),
    budget_status: "yes",
    budget_explanation: null,
    justification: "Coffee and cups for the guest welcome table on Sunday mornings.",
    certification_accepted: true,
    certification_name: "Jordan Example",
    sms_opt_in: false,
    items: [
      { description: "Coffee beans", quantity: "3", estimated_unit_price: "19.99", vendor_name: "Coffee Co" },
      { description: "Paper cups (pack of 100)", quantity: "2.5", estimated_unit_price: "10.01" },
    ],
    ...overrides,
  };
}

export async function submit(db: Db, body: Record<string, unknown>, files: unknown[] = [], token = FORM_TOKEN) {
  return as(db, "service_role", null, async () => {
    const row = await one<{ r: Record<string, unknown> }>(
      db,
      "select public.submit_requisition($1, $2::jsonb, $3::jsonb, $4) as r",
      [token, JSON.stringify(body), JSON.stringify(files), "fp-" + Math.random()],
    );
    return row.r as {
      id: string;
      requisition_number: string;
      estimated_total: string;
      status: string;
      reply_token: string;
    };
  });
}

/** Simulate a file already uploaded to Storage. */
export async function putObject(db: Db, name: string, mimetype = "application/pdf", size = 2048) {
  await db.query(
    `insert into storage.objects (bucket_id, name, metadata) values ('receipts', $1, jsonb_build_object('mimetype', $2::text, 'size', $3::int))`,
    [name, mimetype, size],
  );
}

export async function rpc<T = Record<string, unknown>>(db: Db, userId: string, sql: string, params: unknown[] = []) {
  return as(db, "authenticated", userId, async () => {
    const row = await one<{ r: T }>(db, sql, params);
    return row.r;
  });
}
