/** Inbox server actions and queries: session required, own rows via RLS, ids validated. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));

interface Call { method: string; args: unknown[] }
let calls: Call[];
let rpcResult: Record<string, { data: unknown; error: unknown }>;
let listResult: { data: unknown[]; count: number };
function builder() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "order", "limit", "is", "eq", "range"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(listResult);
  return chain;
}
const supabase = {
  rpc: vi.fn(async (name: string, args?: unknown) => {
    calls.push({ method: `rpc:${name}`, args: [args] });
    return rpcResult[name] ?? { data: null, error: null };
  }),
  from: vi.fn((table: string) => {
    calls.push({ method: "from", args: [table] });
    return builder();
  }),
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => supabase }));

const actions = await import("@/app/(app)/notifications/actions");
const queries = await import("@/lib/notifications/queries");

const ID = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

beforeEach(() => {
  calls = [];
  rpcResult = { unread_notification_count: { data: 2, error: null }, mark_notification_read: { data: true, error: null }, mark_all_notifications_read: { data: 3, error: null } };
  listResult = { data: [], count: 0 };
  getSessionUser.mockResolvedValue({ id: "u1" });
});

describe("server actions", () => {
  it("require a signed-in user", async () => {
    getSessionUser.mockResolvedValue(null);
    for (const r of [await actions.markNotificationRead(ID), await actions.markAllNotificationsRead(), await actions.loadUnreadCount(), await actions.loadNotificationPanel()]) {
      expect(r).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    }
    expect(supabase.rpc).not.toHaveBeenCalledWith("mark_notification_read", expect.anything());
  });

  it("mark one read: validates the id and leaves ownership to the database function", async () => {
    expect(await actions.markNotificationRead("../../etc")).toEqual({ ok: false, error: "That notification could not be found." });
    expect(await actions.markNotificationRead(ID)).toEqual({ ok: true, data: { unread: 2 } });
    expect(calls.find((c) => c.method === "rpc:mark_notification_read")?.args).toEqual([{ p_id: ID }]);
  });

  it("mark all read never takes a user id from the client", async () => {
    const r = await actions.markAllNotificationsRead();
    expect(r).toMatchObject({ ok: true, data: { unread: 2 } });
    expect(calls.find((c) => c.method === "rpc:mark_all_notifications_read")?.args).toEqual([undefined]);
  });

  it("reports database failures without details", async () => {
    rpcResult.mark_notification_read = { data: null, error: { code: "XX000", message: "internal detail" } };
    expect(await actions.markNotificationRead(ID)).toEqual({ ok: false, error: "The notification could not be updated. Please try again." });
  });
});

describe("queries", () => {
  it("lists own rows newest first with filters and pagination", async () => {
    listResult = { data: [{ id: ID }], count: 60 };
    const result = await queries.listNotifications("unread", 2);
    expect(result).toEqual({ rows: [{ id: ID }], total: 60, pages: 3 });
    expect(calls).toEqual(expect.arrayContaining([
      { method: "from", args: ["user_notifications"] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "is", args: ["read_at", null] },
      { method: "range", args: [25, 49] },
    ]));
    calls = [];
    await queries.listNotifications("purchasing", 1);
    expect(calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["category", "purchasing"] }, { method: "range", args: [0, 24] }]));
    calls = [];
    await queries.listNotifications("all", 99999);
    expect(calls.some((c) => c.method === "eq" || c.method === "is")).toBe(false);
    expect(calls.find((c) => c.method === "range")?.args).toEqual([999 * 25, 1000 * 25 - 1]);
  });

  it("unread count falls back to 0 on error; Needs Attention maps the RPC result", async () => {
    rpcResult.unread_notification_count = { data: null, error: { message: "x" } };
    expect(await queries.getUnreadCount()).toBe(0);
    rpcResult.my_needs_attention = { data: { on_hold: { count: 2 } }, error: null };
    expect((await queries.getNeedsAttention()).map((c) => [c.key, c.count])).toEqual([["on_hold", 2]]);
    rpcResult.my_needs_attention = { data: null, error: { message: "x" } };
    expect(await queries.getNeedsAttention()).toEqual([]);
  });
});
