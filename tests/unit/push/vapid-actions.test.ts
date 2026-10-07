/** VAPID configuration gating and the push-settings server actions. */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getSessionUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getSessionUser: () => getSessionUser() }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ rpc }) }));

const PUBLIC = "BAbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjK";
const PRIVATE = "pR1vAtEkEyAbCdEfGhIjKlMnOpQrStUvWxYz0123456";
const EP = "https://fcm.googleapis.com/fcm/send/device-1";
const KEYS = { p256dh: "BPu7ShjHv_X1lC3h5i_vG0oR0Ksw0C9bJZzYk1b8ZtQe2sB9Yl3n5vGgK1w5kq7T3x2b0Rk8yWQn4T6m0gX1a2c", auth: "k7Yv2XsL3qN9pR1tUwZ0aQ" };

function setEnv(pub?: string, priv?: string, subject?: string) {
  for (const [k, v] of [["NEXT_PUBLIC_VAPID_PUBLIC_KEY", pub], ["VAPID_PRIVATE_KEY", priv], ["VAPID_SUBJECT", subject]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const { vapidConfig } = await import("@/lib/push/vapid");
const actions = await import("@/app/(app)/notifications/push-actions");

beforeEach(() => {
  getSessionUser.mockResolvedValue({ id: "u1" });
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { transferred: false, this_device: true, push_level: "actionable", devices: [] }, error: null });
  setEnv(PUBLIC, PRIVATE, "mailto:operations@thekingstribe.org");
});

describe("vapidConfig", () => {
  it("is null (push off) when any value is missing or malformed", () => {
    setEnv(undefined, PRIVATE, "mailto:a@b.org");
    expect(vapidConfig()).toBeNull();
    setEnv(PUBLIC, undefined, "mailto:a@b.org");
    expect(vapidConfig()).toBeNull();
    setEnv(PUBLIC, PRIVATE, undefined);
    expect(vapidConfig()).toBeNull();
    setEnv(PUBLIC, PRIVATE, "not-a-subject");
    expect(vapidConfig()).toBeNull();
    setEnv("short", PRIVATE, "mailto:a@b.org");
    expect(vapidConfig()).toBeNull();
  });
  it("accepts mailto: or https: subjects", () => {
    expect(vapidConfig()).toEqual({ publicKey: PUBLIC, privateKey: PRIVATE, subject: "mailto:operations@thekingstribe.org" });
    setEnv(PUBLIC, PRIVATE, "https://ops.thekingstribe.org");
    expect(vapidConfig()?.subject).toBe("https://ops.thekingstribe.org");
  });
});

describe("push-settings actions", () => {
  it("require a signed-in user", async () => {
    getSessionUser.mockResolvedValue(null);
    for (const r of [await actions.getPushStatus(null), await actions.savePushSubscription({ endpoint: EP, keys: KEYS }), await actions.removePushSubscription(EP), await actions.removePushDevice("x"), await actions.setPushLevel("important")]) {
      expect(r).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to save when VAPID is not configured", async () => {
    setEnv(undefined, undefined, undefined);
    expect(await actions.savePushSubscription({ endpoint: EP, keys: KEYS })).toEqual({ ok: false, error: "Phone notifications are not set up yet." });
    const s = await actions.getPushStatus(EP);
    expect(s.ok && s.data.configured).toBe(false);
  });

  it("validates the subscription (allowlisted endpoint, key formats) before calling the database", async () => {
    for (const bad of [{ endpoint: "https://evil.example.com/x", keys: KEYS }, { endpoint: EP, keys: { p256dh: "x", auth: KEYS.auth } }, { endpoint: EP }, null, "x"]) {
      expect(await actions.savePushSubscription(bad)).toEqual({ ok: false, error: "This browser's push subscription could not be saved." });
    }
    expect(rpc).not.toHaveBeenCalled();
    const ok = await actions.savePushSubscription({ endpoint: EP, keys: KEYS, label: "iPhone · Safari" });
    expect(ok).toMatchObject({ ok: true, data: { transferred: false } });
    expect(rpc).toHaveBeenCalledWith("save_push_subscription", { p_endpoint: EP, p_p256dh: KEYS.p256dh, p_auth: KEYS.auth, p_device_label: "iPhone · Safari" });
  });

  it("status passes only an allowlisted endpoint and returns no keys", async () => {
    await actions.getPushStatus("https://evil.example.com/x");
    expect(rpc).toHaveBeenCalledWith("my_push_status", { p_endpoint: null });
    const s = await actions.getPushStatus(EP);
    expect(s).toEqual({ ok: true, data: { configured: true, thisDevice: true, pushLevel: "actionable", devices: [] } });
  });

  it("removal and level validate their input", async () => {
    expect(await actions.removePushSubscription("https://evil.example.com/x")).toMatchObject({ ok: false });
    expect(await actions.removePushDevice("not-a-uuid")).toMatchObject({ ok: false });
    expect(await actions.setPushLevel("everything")).toEqual({ ok: false, error: "Choose a valid option." });
    expect(await actions.setPushLevel("important")).toMatchObject({ ok: true, data: { pushLevel: "important" } });
    expect(rpc).toHaveBeenCalledWith("set_my_push_level", { p_level: "important" });
  });
});
