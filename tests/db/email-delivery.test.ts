/** Migration 20261007000100: Resend delivery tracking. */
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrationsFrom, as, createTestDatabase, createUser, expectError, one, type Db } from "./harness";

const MIGRATION = "20261007000100_email_delivery_tracking.sql";
let db: Db;

async function notification(messageId: string | null, status = "sent", channel = "email") {
  return (await one<{ id: string }>(db,
    "insert into public.notifications (channel, template, recipient, subject, status, provider_message_id) values ($1, 'requisition_submitted', 'a@example.org', 'S', $2, $3) returning id",
    [channel, status, messageId])).id;
}
const record = (eventId: string, messageId: string, type: string, at: string, detail: string | null = null) =>
  as(db, "service_role", null, async () =>
    (await one<{ r: { result: string; delivery_status?: string } }>(db, "select public.record_email_delivery_event($1, $2, $3, $4::timestamptz, $5) as r", [eventId, messageId, type, at, detail])).r);
const state = (id: string) => one<{ delivery_status: string | null; delivery_status_at: string | null; last: string | null; events: number }>(db,
  "select delivery_status::text, to_char(delivery_status_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as delivery_status_at, to_char(last_provider_event_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') as last, (select count(*)::int from public.notification_events e where e.notification_id = n.id) as events from public.notifications n where id = $1", [id]);

beforeAll(async () => {
  db = await createTestDatabase();
});

describe("recording provider events", () => {
  it("matches only by provider message id and stores the lifecycle", async () => {
    const id = await notification("msg-known-1");
    expect((await state(id)).delivery_status).toBeNull(); // accepted, no update yet
    expect(await record("evt_1", "msg-known-1", "sent", "2026-10-07T10:00:00Z")).toMatchObject({ result: "recorded", delivery_status: "sent" });
    expect(await record("evt_2", "msg-known-1", "delivered", "2026-10-07T10:00:05Z")).toMatchObject({ result: "recorded", delivery_status: "delivered" });
    expect(await state(id)).toMatchObject({ delivery_status: "delivered", events: 2 });
  });

  it("ignores unknown message ids without touching any notification", async () => {
    const id = await notification("msg-other");
    expect(await record("evt_u", "msg-does-not-exist", "delivered", "2026-10-07T10:00:00Z")).toEqual({ result: "unmatched" });
    expect(await state(id)).toMatchObject({ delivery_status: null, events: 0 });
  });

  it("is idempotent for duplicate deliveries of the same event", async () => {
    const id = await notification("msg-dup");
    await record("evt_dup", "msg-dup", "delivered", "2026-10-07T10:00:00Z");
    expect(await record("evt_dup", "msg-dup", "delivered", "2026-10-07T10:00:00Z")).toMatchObject({ result: "duplicate", delivery_status: "delivered" });
    expect(await record("evt_dup", "msg-dup", "bounced", "2026-10-07T11:00:00Z")).toMatchObject({ result: "duplicate" }); // same id never re-applied
    expect(await state(id)).toMatchObject({ delivery_status: "delivered", events: 1 });
  });

  it("never regresses on out-of-order events", async () => {
    const id = await notification("msg-ooo");
    await record("o1", "msg-ooo", "delivered", "2026-10-07T10:00:05Z");
    await record("o2", "msg-ooo", "sent", "2026-10-07T10:00:00Z"); // older 'sent' arrives late
    await record("o3", "msg-ooo", "delivery_delayed", "2026-10-07T10:00:02Z");
    expect(await state(id)).toMatchObject({ delivery_status: "delivered", delivery_status_at: expect.stringContaining("10:00:05"), events: 3 });
    expect((await state(id)).last).toContain("10:00:05");
  });

  it("delayed → delivered, and delayed → bounced", async () => {
    const a = await notification("msg-d1");
    await record("d1a", "msg-d1", "delivery_delayed", "2026-10-07T10:00:00Z");
    expect((await state(a)).delivery_status).toBe("delivery_delayed");
    await record("d1b", "msg-d1", "delivered", "2026-10-07T12:00:00Z");
    expect((await state(a)).delivery_status).toBe("delivered");
    const b = await notification("msg-d2");
    await record("d2a", "msg-d2", "delivery_delayed", "2026-10-07T10:00:00Z");
    await record("d2b", "msg-d2", "bounced", "2026-10-08T10:00:00Z", "Permanent / General");
    expect((await state(b)).delivery_status).toBe("bounced");
    const ev = await one<{ detail: string }>(db, "select detail from public.notification_events where provider_event_id = 'd2b'");
    expect(ev.detail).toBe("Permanent / General");
  });

  it("terminal outcomes: bounced, failed, suppressed stay final; a complaint follows delivery", async () => {
    for (const [msg, type] of [["msg-b", "bounced"], ["msg-f", "failed"], ["msg-s", "suppressed"]] as const) {
      const id = await notification(msg);
      await record(`${msg}-1`, msg, type, "2026-10-07T10:00:00Z");
      await record(`${msg}-2`, msg, "sent", "2026-10-07T10:00:01Z");
      await record(`${msg}-3`, msg, "delivery_delayed", "2026-10-07T10:00:02Z");
      expect((await state(id)).delivery_status).toBe(type);
    }
    const c = await notification("msg-c");
    await record("c1", "msg-c", "delivered", "2026-10-07T10:00:00Z");
    await record("c2", "msg-c", "complained", "2026-10-07T13:00:00Z");
    await record("c3", "msg-c", "delivered", "2026-10-07T10:00:00Z".replace("10:00", "10:01"));
    expect((await state(c)).delivery_status).toBe("complained");
  });

  it("ignores unsupported event types and non-accepted rows", async () => {
    const id = await notification("msg-x");
    expect(await record("x1", "msg-x", "opened", "2026-10-07T10:00:00Z")).toMatchObject({ result: "ignored" });
    expect((await state(id)).events).toBe(0);
    const skipped = await notification("msg-skipped", "skipped");
    expect(await record("x2", "msg-skipped", "delivered", "2026-10-07T10:00:00Z")).toEqual({ result: "unmatched" });
    expect((await state(skipped)).delivery_status).toBeNull();
    const sms = await notification("msg-sms", "sent", "sms");
    expect(await record("x3", "msg-sms", "delivered", "2026-10-07T10:00:00Z")).toEqual({ result: "unmatched" });
    expect((await state(sms)).delivery_status).toBeNull();
  });
});

describe("security", () => {
  it("only the trusted server role can record events", async () => {
    const user = await createUser(db, "admin-de@example.org", ["administrator"]);
    await expectError(as(db, "anon", null, () => db.query("select public.record_email_delivery_event('e','m','delivered',now())")), /permission denied/);
    await expectError(as(db, "authenticated", user, () => db.query("select public.record_email_delivery_event('e','m','delivered',now())")), /permission denied/);
    await expectError(as(db, "authenticated", user, () => db.query("insert into public.notification_events (notification_id, provider_event_id, event_type, occurred_at) select id, 'forged', 'delivered', now() from public.notifications limit 1")), /permission denied/);
    await expectError(as(db, "authenticated", user, () => db.query("update public.notifications set delivery_status = 'delivered'")), /permission denied/);
  });

  it("history is readable with requisitions.view, append-only, and hidden from others", async () => {
    const admin = await createUser(db, "admin-de2@example.org", ["administrator"]);
    const viewer = await createUser(db, "viewer-de@example.org", ["viewer"]);
    const seenByAdmin = await as(db, "authenticated", admin, () => db.query("select provider_event_id from public.notification_events"));
    expect(seenByAdmin.rows.length).toBeGreaterThan(0);
    const seenByViewer = await as(db, "authenticated", viewer, () => db.query("select 1 from public.notification_events"));
    expect(seenByViewer.rows).toHaveLength(0); // viewer role has no requisitions.view by default
    await expectError(as(db, "anon", null, () => db.query("select 1 from public.notification_events")), /permission denied/);
    await expectError(db.query("update public.notification_events set detail = 'x'"), /append-only/);
    await expectError(db.query("delete from public.notification_events"), /append-only/);
  });
});

describe("existing data", () => {
  it("keeps historical accepted emails truthful (no backfill to Delivered)", async () => {
    const legacy = await createTestDatabase({ before: MIGRATION });
    await legacy.query("insert into public.notifications (channel, template, recipient, status, provider_message_id) values ('email','requisition_submitted','a@example.org','sent','01a11307-legacy'), ('email','finance_new_requisition','f@example.org','skipped',null)");
    const before = await legacy.query("select id, status, provider_message_id from public.notifications order by template");
    await applyMigrationsFrom(legacy, MIGRATION);
    const after = await legacy.query<{ id: string; status: string; provider_message_id: string | null; delivery_status: string | null }>("select id, status, provider_message_id, delivery_status from public.notifications order by template");
    expect(after.rows.map(({ delivery_status, ...r }) => r)).toEqual(before.rows);
    expect(after.rows.every((r) => r.delivery_status === null)).toBe(true);
    expect((await legacy.query("select 1 from public.notification_events")).rows).toHaveLength(0);
  });
});
