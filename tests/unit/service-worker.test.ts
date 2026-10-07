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

function loadWorker(opts: { badge?: boolean; windows?: { url: string; navigate?: boolean }[] } = {}) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const showNotification = vi.fn(async () => {});
  const setAppBadge = vi.fn(async () => {});
  const clearAppBadge = vi.fn(async () => {});
  const windows = (opts.windows ?? []).map((w) => {
    const client = {
      url: w.url,
      focus: vi.fn(async () => client),
      navigate: w.navigate === false ? undefined : vi.fn(async () => client),
    };
    return client;
  });
  const openWindow = vi.fn(async () => null);
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
  return { listeners, run, showNotification, setAppBadge, clearAppBadge, windows, openWindow };
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

describe("service worker: notification click", () => {
  const click = (url: unknown) => ({ notification: { close: vi.fn(), data: { url } } });

  it("focuses an existing app window and navigates it to the record", async () => {
    const w = loadWorker({ windows: [{ url: "https://other.example.com/" }, { url: `${ORIGIN}/dashboard` }] });
    const event = click(`/requisitions/${REQ}`);
    await w.run("notificationclick", event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(w.windows[0].focus).not.toHaveBeenCalled();
    expect(w.windows[1].focus).toHaveBeenCalled();
    expect(w.windows[1].navigate).toHaveBeenCalledWith(`${ORIGIN}/requisitions/${REQ}`);
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it("opens the app when no window is open", async () => {
    const w = loadWorker();
    await w.run("notificationclick", click("/receipts"));
    expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/receipts`);
  });

  it("never opens an external or unsafe target", async () => {
    for (const url of ["https://evil.example.com/", "//evil.example.com/x", "javascript:alert(1)", undefined]) {
      const w = loadWorker();
      await w.run("notificationclick", click(url));
      expect(w.openWindow).toHaveBeenCalledWith(`${ORIGIN}/notifications`);
    }
  });

  it("focuses even when navigation is not possible", async () => {
    const w = loadWorker({ windows: [{ url: `${ORIGIN}/dashboard`, navigate: false }] });
    await w.run("notificationclick", click("/receipts"));
    expect(w.windows[0].focus).toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });
});
