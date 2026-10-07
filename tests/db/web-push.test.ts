/**
 * Web Push (migration 20261010000100): subscription ownership and isolation,
 * ownership transfer, unsubscribe, deactivation, push level, and the
 * claim/record dispatch functions (idempotency, eligibility, cleanup).
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";
import { createFormToken, FORM_TOKEN, lookup, payload, putObject, rpc } from "./fixtures";

let db: Db;
let ids: Awaited<ReturnType<typeof lookup>>;
const u: Record<string, string> = {};
const P256DH = "BPu7ShjHv_X1lC3h5i_vG0oR0Ksw0C9bJZzYk1b8ZtQe2sB9Yl3n5vGgK1w5kq7T3x2b0Rk8yWQn4T6m0gX1a2c";
const AUTH = "k7Yv2XsL3qN9pR1tUwZ0aQ";
let seq = 0;
const endpoint = (host = "fcm.googleapis.com") => `https://${host}/fcm/send/device-${++seq}-${Math.random().toString(36).slice(2)}`;

const asUser = <T,>(id: string | null, fn: () => Promise<T>) => as(db, id ? "authenticated" : "anon", id, fn);
const save = (user: string, ep: string, label = "iPhone · Safari") =>
  asUser(user, async () => (await one<{ r: { transferred: boolean } }>(db, "select public.save_push_subscription($1, $2, $3, $4) as r", [ep, P256DH, AUTH, label])).r);
const status = (user: string, ep: string | null) =>
  asUser(user, async () => (await one<{ r: { this_device: boolean; push_level: string; devices: Record<string, unknown>[] } }>(db, "select public.my_push_status($1) as r", [ep])).r);
const owner = async (ep: string) => (await db.query<{ user_id: string }>("select user_id from public.push_subscriptions where endpoint = $1", [ep])).rows[0]?.user_id ?? null;
const claim = (windowMinutes = 30) =>
  as(db, "service_role", null, async () => (await db.query<{ notification_id: string; subscription_id: string; type: string; importance: string; link: string; unread: number; endpoint: string }>(
    "select * from public.claim_push_batch($1, 50)", [windowMinutes])).rows);
const record = (results: unknown[]) => as(db, "service_role", null, () => db.query("select public.record_push_results($1::jsonb)", [JSON.stringify(results)]));
async function submitReq(over: Record<string, unknown> = {}) {
  return as(db, "service_role", null, async () => (await one<{ r: { id: string } }>(db, "select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, null) as r",
    [FORM_TOKEN, JSON.stringify(payload(ids, { items: [{ description: "Chairs", quantity: "1", estimated_unit_price: "10", priority: "medium" }], ...over }))])).r);
}

beforeAll(async () => {
  db = await createTestDatabase();
  u.admin = await createUser(db, "admin@example.org", ["administrator"]);
  u.head = await createUser(db, "head@example.org", ["head_of_finance"]);
  u.viewer = await createUser(db, "viewer@example.org", ["viewer"]);
  u.leaver = await createUser(db, "leaver@example.org", ["head_of_finance"]);
  ids = await lookup(db);
  await createFormToken(db);
});

beforeEach(async () => {
  await db.query("delete from public.rate_limit_events");
});

describe("subscriptions: ownership and isolation", () => {
  it("saves a subscription for the signed-in user; status never exposes endpoints or keys", async () => {
    const ep = endpoint();
    expect(await save(u.head, ep)).toEqual({ transferred: false });
    expect(await owner(ep)).toBe(u.head);
    const s = await status(u.head, ep);
    expect(s.this_device).toBe(true);
    expect(s.push_level).toBe("actionable");
    expect(s.devices).toHaveLength(1);
    expect(Object.keys(s.devices[0]).sort()).toEqual(["created_at", "id", "label", "last_success_at", "this_device"]);
    expect(JSON.stringify(s)).not.toContain(P256DH);
    expect(JSON.stringify(s)).not.toContain(AUTH);
    expect(JSON.stringify(s)).not.toContain("fcm.googleapis.com");
  });

  it("anonymous users have no access to tables or functions", async () => {
    await expectError(asUser(null, () => db.query("select * from public.push_subscriptions")), /permission denied/);
    await expectError(asUser(null, () => db.query("select public.save_push_subscription($1, $2, $3, null)", [endpoint(), P256DH, AUTH])), /permission denied/);
    await expectError(asUser(null, () => db.query("select public.my_push_status(null)")), /permission denied/);
  });

  it("signed-in users cannot read or write the tables directly", async () => {
    await expectError(asUser(u.head, () => db.query("select endpoint, p256dh, auth from public.push_subscriptions")), /permission denied/);
    await expectError(asUser(u.head, () => db.query("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)", [u.head, endpoint(), P256DH, AUTH])), /permission denied/);
    await expectError(asUser(u.head, () => db.query("update public.user_notification_settings set push_level = 'important'")), /permission denied/);
    await expectError(asUser(u.head, () => db.query("select * from public.push_dispatches")), /permission denied/);
  });

  it("one user cannot see, remove or inspect another user's subscription (IDOR)", async () => {
    const ep = endpoint();
    await save(u.head, ep);
    const deviceId = (await one<{ id: string }>(db, "select id from public.push_subscriptions where endpoint = $1", [ep])).id;
    expect(await asUser(u.admin, async () => (await one<{ r: boolean }>(db, "select public.delete_my_push_subscription($1) as r", [ep])).r)).toBe(false);
    expect(await asUser(u.admin, async () => (await one<{ r: boolean }>(db, "select public.delete_my_push_device($1) as r", [deviceId])).r)).toBe(false);
    const adminView = await status(u.admin, ep);
    expect(adminView.this_device).toBe(false);
    expect(adminView.devices.map((d) => d.id)).not.toContain(deviceId);
    expect(await owner(ep)).toBe(u.head);
  });

  it("supports several devices per user and handles a duplicate save as an update", async () => {
    const [a, b] = [endpoint("web.push.apple.com"), endpoint("updates.push.services.mozilla.com")];
    await save(u.viewer, a, "iPhone · Safari");
    await save(u.viewer, b, "Mac · Firefox");
    await save(u.viewer, a, "iPhone · Safari (again)");
    const rows = await db.query<{ device_label: string }>("select device_label from public.push_subscriptions where user_id = $1 order by created_at", [u.viewer]);
    expect(rows.rows.map((r) => r.device_label)).toEqual(["iPhone · Safari (again)", "Mac · Firefox"]);
    expect((await status(u.viewer, b)).devices).toHaveLength(2);
  });

  it("transfers a browser's subscription to the user who explicitly enables it there", async () => {
    const ep = endpoint();
    await save(u.head, ep);
    expect(await save(u.admin, ep)).toEqual({ transferred: true });
    expect(await owner(ep)).toBe(u.admin);
    expect((await status(u.head, ep)).this_device).toBe(false);
    expect((await status(u.admin, ep)).this_device).toBe(true);
  });

  it("unsubscribing removes only the caller's own subscription", async () => {
    const ep = endpoint();
    await save(u.head, ep);
    expect(await asUser(u.head, async () => (await one<{ r: boolean }>(db, "select public.delete_my_push_subscription($1) as r", [ep])).r)).toBe(true);
    expect(await owner(ep)).toBeNull();
    const ep2 = endpoint();
    await save(u.head, ep2);
    const id = (await one<{ id: string }>(db, "select id from public.push_subscriptions where endpoint = $1", [ep2])).id;
    expect(await asUser(u.head, async () => (await one<{ r: boolean }>(db, "select public.delete_my_push_device($1) as r", [id])).r)).toBe(true);
    expect(await owner(ep2)).toBeNull();
  });

  it.each([
    "https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.com/x",
    "https://127.0.0.1/x", "https://metadata.google.internal/x", "javascript:alert(1)",
  ])("rejects a non-push-service endpoint %s", async (ep) => {
    await expectError(save(u.head, ep), /push_subscriptions_endpoint_check/);
  });

  it("rejects malformed keys", async () => {
    await expectError(asUser(u.head, () => db.query("select public.save_push_subscription($1, $2, $3, null)", [endpoint(), "not base64!", AUTH])), /p256dh_check/);
    await expectError(asUser(u.head, () => db.query("select public.save_push_subscription($1, $2, $3, null)", [endpoint(), P256DH, "x"])), /auth_check/);
  });

  it("deactivating a user removes their devices and blocks new ones", async () => {
    await save(u.leaver, endpoint());
    await save(u.leaver, endpoint());
    await db.query("update public.profiles set is_active = false where id = $1", [u.leaver]);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.push_subscriptions where user_id = $1", [u.leaver])).n).toBe(0);
    await expectError(save(u.leaver, endpoint()), /permission denied/);
  });

  it("push level is per user, defaults to actionable, and changes are audited", async () => {
    expect((await status(u.viewer, null)).push_level).toBe("actionable");
    await asUser(u.viewer, () => db.query("select public.set_my_push_level('important')"));
    expect((await status(u.viewer, null)).push_level).toBe("important");
    await expectError(asUser(u.viewer, () => db.query("select public.set_my_push_level('everything')")), /invalid input value/);
    const audit = await one<{ n: number }>(db, "select count(*)::int as n from public.audit_logs where entity_type = 'notification_settings' and action like 'notification_settings.%'");
    expect(audit.n).toBeGreaterThan(0);
    await asUser(u.viewer, () => db.query("select public.set_my_push_level('actionable')"));
  });
});

describe("dispatch: claim and record (service role only)", () => {
  let headEp: string;
  let adminEps: string[];

  beforeAll(async () => {
    await db.query("delete from public.push_subscriptions");
    headEp = endpoint();
    adminEps = [endpoint("web.push.apple.com"), endpoint()];
    await save(u.head, headEp, "Android · Chrome");
    for (const ep of adminEps) await save(u.admin, ep);
    await claim(); // flush anything created earlier
  });

  it("is not callable by signed-in users", async () => {
    await expectError(asUser(u.admin, () => db.query("select * from public.claim_push_batch(30, 50)")), /permission denied/);
    await expectError(asUser(u.admin, () => db.query("select public.record_push_results('[]'::jsonb)")), /permission denied/);
  });

  it("claims each new inbox row once, one row per device, with the unread count", async () => {
    const r = await submitReq();
    const rows = await claim();
    const forReq = rows.filter((x) => x.link === `/requisitions/${r.id}`);
    expect(forReq).toHaveLength(3); // head × 1 device + admin × 2 devices
    expect(new Set(forReq.map((x) => x.type))).toEqual(new Set(["requisition.submitted"]));
    expect(forReq.every((x) => x.unread >= 1)).toBe(true);
    // Idempotent: a second (or concurrent) claim gets nothing.
    expect((await claim()).filter((x) => x.link === `/requisitions/${r.id}`)).toEqual([]);
    const d = await db.query<{ status: string }>("select d.status from public.push_dispatches d join public.user_notifications n on n.id = d.notification_id where n.requisition_id = $1", [r.id]);
    expect(d.rows.map((x) => x.status)).toEqual(["claimed", "claimed"]);
  });

  it("never pushes low-importance events (skipped, in-app only)", async () => {
    const r = await submitReq();
    await claim();
    await rpc(db, u.admin, "select public.review_requisition($1, 'reject', '[]'::jsonb, 'Not in budget') as r", [r.id]);
    const rows = await claim();
    expect(rows.filter((x) => x.type === "requisition.rejected")).toEqual([]);
    const d = await one<{ status: string }>(db, "select d.status from public.push_dispatches d join public.user_notifications n on n.id = d.notification_id where n.requisition_id = $1 and n.type = 'requisition.rejected'", [r.id]);
    expect(d.status).toBe("skipped");
  });

  it("'Important only' pushes high-importance and assignments, not other normal events", async () => {
    await asUser(u.head, () => db.query("select public.set_my_push_level('important')"));
    const normal = await submitReq();
    const essential = await as(db, "service_role", null, async () => (await one<{ r: { id: string } }>(db,
      "select public.submit_requisition_with_priority($1, $2::jsonb, '[]'::jsonb, null) as r",
      [FORM_TOKEN, JSON.stringify(payload(ids, { items: [{ description: "Mic", quantity: "1", estimated_unit_price: "5", priority: "essential", essential_justification: "Needed before Sunday service." }] }))])).r);
    const rows = await claim();
    const headSubs = rows.filter((x) => x.endpoint === headEp);
    expect(headSubs.map((x) => x.link)).toEqual([`/requisitions/${essential.id}`]);
    expect(headSubs[0].importance).toBe("high");
    expect(rows.some((x) => x.link === `/requisitions/${normal.id}` && x.endpoint !== headEp)).toBe(true); // admin is still 'actionable'
    await rpc(db, u.admin, "select public.assign_requisition_reviewer($1, $2) as r", [normal.id, u.head]);
    expect((await claim()).filter((x) => x.endpoint === headEp).map((x) => x.type)).toEqual(["requisition.assigned"]);
    await asUser(u.head, () => db.query("select public.set_my_push_level('actionable')"));
  });

  it("skips users without a device, and users who lost the row's permission", async () => {
    await db.query("insert into public.roles (key, name) values ('rec', 'Rec')");
    await db.query("insert into public.role_permissions (role_id, permission_key) select id, p from public.roles, unnest(array['receipts.reconcile','requisitions.view']) p where key = 'rec'");
    const rec = await createUser(db, "rec@example.org", ["rec"]);
    // An unmatched email receipt notifies everyone who reconciles: admin, head and rec (who has no device).
    await putObject(db, "inbound/push-1/r.pdf");
    const out = await as(db, "service_role", null, async () => (await one<{ r: { receipt_id: string } }>(db,
      "select public.ingest_inbound_email($1::jsonb, '{}'::jsonb, $2::jsonb) as r",
      [JSON.stringify({ provider: "resend", provider_message_id: "push-1", from: "x@y.org", subject: "r" }), JSON.stringify([{ path: "inbound/push-1/r.pdf" }])])).r);
    const rows = await claim();
    const recNote = await one<{ id: string }>(db, "select id from public.user_notifications where receipt_id = $1 and user_id = $2", [out.receipt_id, rec]);
    expect(rows.some((x) => x.notification_id === recNote.id)).toBe(false);
    expect((await one<{ status: string }>(db, "select status from public.push_dispatches where notification_id = $1", [recNote.id])).status).toBe("skipped");
    expect(rows.filter((x) => x.type === "receipt.unmatched").length).toBe(3); // head × 1 + admin × 2
    // Revoked permission: head loses requisitions.view before dispatch.
    const r2 = await submitReq();
    await db.query("delete from public.role_permissions where role_id = (select id from public.roles where key = 'head_of_finance') and permission_key = 'requisitions.view'");
    const afterRevoke = await claim();
    expect(afterRevoke.filter((x) => x.link === `/requisitions/${r2.id}` && x.endpoint === headEp)).toEqual([]);
    await db.query("insert into public.role_permissions (role_id, permission_key) select id, 'requisitions.view' from public.roles where key = 'head_of_finance'");
  });

  it("never pushes late: rows older than the window are not claimed", async () => {
    const r = await submitReq();
    await db.query("update public.user_notifications set created_at = now() - interval '2 hours' where requisition_id = $1", [r.id]);
    expect((await claim(30)).filter((x) => x.link === `/requisitions/${r.id}`)).toEqual([]);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.push_dispatches d join public.user_notifications n on n.id = d.notification_id where n.requisition_id = $1", [r.id])).n).toBe(0);
  });

  it("records results: sent resets failures, gone deletes, transient failures count up and leave the inbox intact", async () => {
    const r = await submitReq();
    const rows = (await claim()).filter((x) => x.link === `/requisitions/${r.id}`);
    const bySub = (ep: string) => rows.find((x) => x.endpoint === ep)!;
    const inboxBefore = await db.query("select id, read_at from public.user_notifications where requisition_id = $1 order by id", [r.id]);
    await record([
      { notification_id: bySub(headEp).notification_id, subscription_id: bySub(headEp).subscription_id, outcome: "failed" },
      { notification_id: bySub(adminEps[0]).notification_id, subscription_id: bySub(adminEps[0]).subscription_id, outcome: "gone" },
      { notification_id: bySub(adminEps[1]).notification_id, subscription_id: bySub(adminEps[1]).subscription_id, outcome: "sent" },
    ]);
    expect(await owner(adminEps[0])).toBeNull(); // 410/404 -> removed
    const head = await one<{ failure_count: number }>(db, "select failure_count from public.push_subscriptions where endpoint = $1", [headEp]);
    expect(head.failure_count).toBe(1); // transient -> kept
    const admin2 = await one<{ failure_count: number; last_success_at: string | null }>(db, "select failure_count, last_success_at from public.push_subscriptions where endpoint = $1", [adminEps[1]]);
    expect(admin2).toMatchObject({ failure_count: 0 });
    expect(admin2.last_success_at).not.toBeNull();
    const statuses = await db.query<{ user_id: string; status: string; sent_count: number; failed_count: number }>(
      "select n.user_id, d.status, d.sent_count, d.failed_count from public.push_dispatches d join public.user_notifications n on n.id = d.notification_id where n.requisition_id = $1", [r.id]);
    expect(statuses.rows.find((x) => x.user_id === u.head)).toMatchObject({ status: "failed", sent_count: 0, failed_count: 1 });
    expect(statuses.rows.find((x) => x.user_id === u.admin)).toMatchObject({ status: "sent", sent_count: 1, failed_count: 1 });
    // The inbox (source of truth) is untouched by push outcomes.
    expect((await db.query("select id, read_at from public.user_notifications where requisition_id = $1 order by id", [r.id])).rows).toEqual(inboxBefore.rows);
    adminEps = [adminEps[1]];
  });

  it("removes a subscription only after 10 consecutive transient failures", async () => {
    const sub = await one<{ id: string }>(db, "select id from public.push_subscriptions where endpoint = $1", [headEp]);
    await db.query("update public.push_subscriptions set failure_count = 8 where id = $1", [sub.id]);
    await record([{ notification_id: null, subscription_id: sub.id, outcome: "failed" }]);
    expect(await owner(headEp)).toBe(u.head); // 9
    await record([{ notification_id: null, subscription_id: sub.id, outcome: "failed" }]);
    expect(await owner(headEp)).toBeNull(); // 10 -> removed
  });
});

describe("TEMPORARY administrator self-test result recording", () => {
  it("records subscription health only: no dispatch, inbox, email, workflow or audit rows", async () => {
    const ep = endpoint("web.push.apple.com");
    await save(u.admin, ep);
    const sub = await one<{ id: string }>(db, "select id from public.push_subscriptions where endpoint = $1", [ep]);
    const counts = () => one<Record<string, number>>(db, `select
      (select count(*) from public.push_dispatches)::int dispatches, (select count(*) from public.user_notifications)::int inbox,
      (select count(*) from public.notifications)::int emails, (select count(*) from public.requisition_status_history)::int history,
      (select count(*) from public.requisitions)::int requisitions, (select count(*) from public.receipts)::int receipts,
      (select count(*) from public.purchase_orders)::int pos, (select count(*) from public.vendor_orders)::int vendor_orders,
      (select count(*) from public.audit_logs)::int audit`);
    const before = await counts();
    await record([{ notification_id: null, subscription_id: sub.id, outcome: "sent" }]);
    expect(await counts()).toEqual(before);
    const after = await one<{ last_success_at: string | null; failure_count: number }>(db, "select last_success_at, failure_count from public.push_subscriptions where id = $1", [sub.id]);
    expect(after.last_success_at).not.toBeNull();
    expect(after.failure_count).toBe(0);
  });
});

describe("Release 1 and other features are unaffected", () => {
  it("inbox rows, RLS and email tables behave exactly as before", async () => {
    const before = await one<{ n: number }>(db, "select count(*)::int as n from public.notifications");
    const r = await submitReq();
    const inbox = await asUser(u.admin, () => db.query<{ type: string }>("select type from public.user_notifications where requisition_id = $1", [r.id]));
    expect(inbox.rows.map((x) => x.type)).toEqual(["requisition.submitted"]);
    expect((await one<{ n: number }>(db, "select count(*)::int as n from public.notifications")).n).toBe(before.n);
  });

  it("Product Auto-Fill submissions still work", async () => {
    const r = await as(db, "service_role", null, async () => (await one<{ r: { id: string } }>(db,
      "select public.submit_requisition_with_product($1, $2::jsonb, '[]'::jsonb, null) as r",
      [FORM_TOKEN, JSON.stringify(payload(ids, { items: [{ description: "Chair", quantity: "1", estimated_unit_price: "10", priority: "medium", requested_sku: "SKU-1", lookup: { status: "none" } }] }))])).r);
    expect((await one<{ s: string }>(db, "select requested_sku as s from public.requisition_items where requisition_id = $1", [r.id])).s).toBe("SKU-1");
  });
});
