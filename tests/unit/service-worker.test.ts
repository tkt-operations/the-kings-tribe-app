/**
 * public/sw.js executed in a sandbox with a fake ServiceWorkerGlobalScope:
 * push display, payload sanitising, badge, notification click (focus an
 * existing window or open one), deep-link allowlist, and that the existing
 * caching handlers are still registered.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://ops.thekingstribe.org";
const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

type WindowSpec = { url: string; navigate?: "ok" | "missing" | "rejects" | "null"; focused?: boolean; visibilityState?: string };

function loadWorker(opts: { badge?: boolean; windows?: WindowSpec[] } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const calls: string[] = [];
  const showNotification = vi.fn(async () => {});
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  const windows = (opts.windows ?? []).map((w) => {
    const client: Record<string, unknown> = { url: w.url, focused: Boolean(w.focused), visibilityState: w.visibilityState ?? "hidden" };
    client.focus = vi.fn(async () => { calls.push(`focus ${String(client.url).replace(ORIGIN, "")}`); return client; });
    client.postMessage = vi.fn((m: { type: string; url: string }) => calls.push(`postMessage ${m.type} ${m.url}`));
    const mode = w.navigate ?? "ok";
    if (mode !== "missing") {
      client.navigate = vi.fn(async (u: string) => {
        calls.push(`navigate ${u.replace(ORIGIN, "")}`);
        if (mode === "rejects") throw new TypeError("not controlled");
        if (mode === "null") return null;
        client.url = u;
        return client;
      });
    }
    return client as { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  });
  const openWindow = vi.fn(async (u: string) => { calls.push(`openWindow ${u.replace(ORIGIN, "")}`); return null; });
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    registration: { showNotification },
    location: { origin: ORIGIN },
    navigator: opts.badge === false ? {} : { setAppBadge, clearAppBadge },
    clients: { matchAll: vi.fn(async () => windows), openWindow, claim: vi.fn() },
    skipWaiting: vi.fn(),
  };
  vm.runInNewContext(SOURCE, { self, caches: {}, fetch: vi.fn(), URL, Promise, console });
  const run = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  return { listeners, run, showNotification, setAppBadge, clearAppBadge, windows, openWindow, calls };
}

const pushEvent = (data: unknown) => ({ data: { json: () => (typeof data === "string" ? JSON.parse(data) : data) } });

describe("service worker: push", () => {
  it("keeps the existing install/activate/fetch handlers", () => {
    const w = loadWorker();
    for (const type of ["install", "activate", "fetch", "push", "notificationclick"]) expect(typeof w.listeners[type]).toBe("function");
  });

  it("shows a generic alert with the fixed title, a safe link and the tag, and sets the badge", async () => {
    const w = loadWorker();
    await w.run("push", pushEvent({ title: "Spoofed title", body: "Receipt ready to reconcile", url: `/requisitions/${REQ}`, tag: REQ, badge: 3 }));
    expect(w.showNotification).toHaveBeenCalledWith("The Kings Tribe", { body: "Receipt ready to reconcile", icon: "/icons/icon-192.png", data: { url: `/requisitions/${REQ}` }, tag: REQ });
    expect(w.setAppBadge).toHaveBeenCalledWith(3);
  });

  it("clears the badge at zero and works without the Badge API", async () => {
    const w = loadWorker();
    await w.run("push", pushEvent({ body: "x", url: "/receipts", badge: 0 }));
    expect(w.clearAppBadge).toHaveBeenCalled();
    const noBadge = loadWorker({ badge: false });
    await noBadge.run("push", pushEvent({ body: "x", url: "/receipts", badge: 5 }));
    expect(noBadge.showNotification).toHaveBeenCalled();
  });

  it.each([
    "https://evil.example.com/", "//evil.example.com", "javascript:alert(1)", "data:text/html,<b>x</b>", "/requisitions/../admin",
    "/requisitions/not-a-uuid", "/admin/users", "/receipts?next=//evil", "", 42, null,
  ])("replaces an unsafe link %j with /notifications", async (url) => {
    const w = loadWorker();
    await w.run("push", pushEvent({ body: "Hello", url, tag: "not-a-uuid" }));
    const options = (w.showNotification.mock.calls[0] as unknown as [string, { data: { url: string }; tag?: string }])[1];
    expect(options.data.url).toBe("/notifications");
    expect(options.tag).toBeUndefined();
  });

  it("survives empty or malformed payloads and caps the text", async () => {
    const w = loadWorker();
    await w.run("push", { data: { json: () => { throw new Error("bad json"); } } });
    await w.run("push", { data: null });
    await w.run("push", pushEvent({ body: "x".repeat(500) }));
    const calls = w.showNotification.mock.calls as unknown as [string, { body: string }][];
    expect(calls[0]).toEqual(["The Kings Tribe", expect.objectContaining({ body: "You have a new notification" })]);
    expect(calls[1][1].body).toBe("You have a new notification");
    expect(calls[2][1].body).toHaveLength(120);
  });

  it("passes text to showNotification as plain text (never HTML)", async () => {
    const w = loadWorker();
    await w.run("push", pushEvent({ body: "<img src=x onerror=alert(1)>" }));
    expect((w.showNotification.mock.calls[0] as unknown as [string, { body: string }])[1].body).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("service worker: notification click opens the exact destination", () => {
  const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });
  const DETAIL = `/requisitions/${REQ}`;

  it("1. existing PWA window on /requisitions → navigates it to the exact detail page, then focuses", async () => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}/requisitions` }] });
    const event = click(DETAIL);
    await w.run("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(w.calls).toEqual([`navigate ${DETAIL}`, `focus ${DETAIL}`]);
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("2. window already on the exact detail page → focus only, no navigation", async () => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}${DETAIL}` }] });
    await w.run("notificationclick", click(DETAIL));
    expect(w.calls).toEqual([`focus ${DETAIL}`]);
  });

  it("3. no open window → opens the exact detail page", async () => {
    const w = loadWorker();
    await w.run("notificationclick", click(DETAIL));
    expect(w.calls).toEqual([`openWindow ${DETAIL}`]);
  });

  it("4. existing window on /dashboard → navigates to the exact detail page, then focuses", async () => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}/dashboard` }] });
    await w.run("notificationclick", click(DETAIL));
    expect(w.calls).toEqual([`navigate ${DETAIL}`, `focus ${DETAIL}`]);
  });

  it.each(["https://evil.example.com/", "//evil.example.com/x", "javascript:alert(1)", "data:text/html,x", "/requisitions/../admin", "/requisitions/not-a-uuid", undefined])(
    "5. unsafe link %j → safe fallback /notifications",
    async (url) => {
      const open = loadWorker();
      await open.run("notificationclick", click(url));
      expect(open.calls).toEqual(["openWindow /notifications"]);
      const existing = loadWorker({ windows: [{ url: `${ORIGIN}/requisitions` }] });
      await existing.run("notificationclick", click(url));
      expect(existing.calls).toEqual(["navigate /notifications", "focus /notifications"]);
    },
  );

  it.each(["/receipts", "/notifications", "/dashboard"])("6–8. valid %s opens exactly that path", async (path) => {
    const open = loadWorker();
    await open.run("notificationclick", click(path));
    expect(open.calls).toEqual([`openWindow ${path}`]);
    const existing = loadWorker({ windows: [{ url: `${ORIGIN}${path === "/dashboard" ? "/receipts" : "/dashboard"}` }] });
    await existing.run("notificationclick", click(path));
    expect(existing.calls).toEqual([`navigate ${path}`, `focus ${path}`]);
  });

  it.each([
    ["navigate() unavailable (iOS installed app)", "missing" as const],
    ["navigate() refused (window not controlled by this worker)", "rejects" as const],
    ["navigate() resolves null", "null" as const],
  ])("when %s, the app is told to route itself to the exact path, then focused", async (_label, mode) => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}/requisitions`, navigate: mode }] });
    await w.run("notificationclick", click(DETAIL));
    const expected = mode === "missing" ? [] : [`navigate ${DETAIL}`];
    expect(w.calls).toEqual([...expected, `postMessage tkt:navigate ${DETAIL}`, "focus /requisitions"]);
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("prefers the focused/visible app window and ignores other origins", async () => {
    const w = loadWorker({ windows: [
      { url: "https://other.example.com/" },
      { url: `${ORIGIN}/receipts`, visibilityState: "hidden" },
      { url: `${ORIGIN}/dashboard`, visibilityState: "visible" },
    ] });
    await w.run("notificationclick", click(DETAIL));
    expect(w.calls).toEqual([`navigate ${DETAIL}`, `focus ${DETAIL}`]);
    expect(w.windows[0].focus).not.toHaveBeenCalled();
    expect(w.windows[1].navigate).not.toHaveBeenCalled();
  });

  it("the message carries only the allowlisted path (no external URL can be injected)", async () => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}/requisitions`, navigate: "missing" }] });
    await w.run("notificationclick", click("https://evil.example.com/steal"));
    expect(w.windows[0].postMessage).toHaveBeenCalledWith({ type: "tkt:navigate", url: "/notifications" });
  });
});
