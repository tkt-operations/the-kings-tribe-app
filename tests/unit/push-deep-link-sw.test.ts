/**
 * public/sw.js remembers a tapped notification's destination (allowlisted path
 * + time only) before trying to open it, so an iOS installed app that resumes,
 * cold-starts at the start page or ignores navigate() can still follow it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PENDING_LINK_CACHE, PENDING_LINK_KEY } from "@/components/pwa/service-worker-registration";

const SOURCE = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://tkt-operations-training.vercel.app";
const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";

function loadWorker(windows: { url: string; navigate?: "ok" | "rejects" }[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const calls: string[] = [];
  const store = new Map<string, Map<string, string>>();
  const caches = {
    open: vi.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return { put: async (key: string, res: Response) => { calls.push(`remember ${name}`); m.set(key, await res.text()); } };
    }),
    keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n),
  };
  const clients = windows.map((w) => {
    const c: Record<string, unknown> = { url: w.url, focused: true, visibilityState: "visible" };
    c.focus = vi.fn(async () => c);
    c.postMessage = vi.fn((m: { url: string }) => calls.push(`postMessage ${m.url}`));
    c.navigate = vi.fn(async (u: string) => { calls.push(`navigate ${u.replace(ORIGIN, "")}`); if (w.navigate === "rejects") throw new TypeError("not controlled"); c.url = u; return c; });
    return c;
  });
  const openWindow = vi.fn(async (u: string) => { calls.push(`openWindow ${u.replace(ORIGIN, "")}`); return null; });
  const self = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { listeners[t] = fn; },
    registration: { showNotification: vi.fn() }, location: { origin: ORIGIN }, navigator: {},
    clients: { matchAll: vi.fn(async () => clients), openWindow, claim: vi.fn() }, skipWaiting: vi.fn(),
  };
  vm.runInNewContext(SOURCE, { self, caches, fetch: vi.fn(), URL, Promise, console, Response, JSON, Date });
  const click = async (url: unknown) => {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({ notification: { close: vi.fn(), data: { url } }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  const remembered = () => {
    const raw = store.get(PENDING_LINK_CACHE)?.get(PENDING_LINK_KEY);
    return raw ? (JSON.parse(raw) as { url: string; at: number }) : null;
  };
  const activate = async () => { let p: Promise<unknown> = Promise.resolve(); listeners.activate({ waitUntil: (x: Promise<unknown>) => { p = x; } }); await p; };
  return { click, remembered, calls, openWindow, activate, store };
}

describe("notification tap: remembered destination", () => {
  it("requisition notification: remembers the exact detail path first, then navigates the open app window there", async () => {
    const w = loadWorker([{ url: `${ORIGIN}/dashboard` }]);
    await w.click(`/requisitions/${REQ}`);
    expect(w.remembered()).toMatchObject({ url: `/requisitions/${REQ}` });
    expect(w.calls).toEqual([`remember ${PENDING_LINK_CACHE}`, `navigate /requisitions/${REQ}`]);
  });

  it("purchasing notification (PO issued → its requisition) and receipts both keep their exact path", async () => {
    for (const target of [`/requisitions/${REQ}`, "/receipts"]) {
      const w = loadWorker([]);
      await w.click(target);
      expect(w.remembered()?.url).toBe(target);
      expect(w.calls.at(-1)).toBe(`openWindow ${target}`);
    }
  });

  it.each([["https://evil.example/requisitions/x"], ["//evil.example"], ["/requisitions/not-a-uuid"], ["javascript:alert(1)"], [null]])(
    "invalid or external destination %j falls back to /notifications (remembered and opened)",
    async (bad) => {
      const w = loadWorker([]);
      await w.click(bad);
      expect(w.remembered()?.url).toBe("/notifications");
      expect(w.calls.at(-1)).toBe("openWindow /notifications");
    },
  );

  it("still messages the page when navigate() is refused (iOS), after remembering", async () => {
    const w = loadWorker([{ url: `${ORIGIN}/dashboard`, navigate: "rejects" }]);
    await w.click(`/requisitions/${REQ}`);
    expect(w.calls).toEqual([`remember ${PENDING_LINK_CACHE}`, `navigate /requisitions/${REQ}`, `postMessage /requisitions/${REQ}`, `openWindow /requisitions/${REQ}`]);
  });

  it("the remembered destination survives a worker update (activate keeps it; old static caches go)", async () => {
    expect(PENDING_LINK_CACHE).toBe("tkt-deeplink");
    expect(SOURCE).toMatch(/const PENDING_LINK_CACHE = "tkt-deeplink";/);
    const w = loadWorker([]);
    await w.click(`/requisitions/${REQ}`);
    w.store.set("tkt-v0-static", new Map());
    w.store.set("tkt-v1-static", new Map());
    await w.activate();
    expect([...w.store.keys()].sort()).toEqual([PENDING_LINK_CACHE, "tkt-v1-static"].sort());
    expect(w.remembered()?.url).toBe(`/requisitions/${REQ}`);
  });

  it("a new worker activates immediately (skipWaiting) and takes over open pages (clients.claim)", () => {
    expect(SOURCE).toMatch(/self\.skipWaiting\(\)/);
    expect(SOURCE).toMatch(/self\.clients\.claim\(\)/);
  });
});

describe("push payload carries the exact in-app path", () => {
  it("requisition and purchasing notifications → that requisition; anything else → /notifications", async () => {
    const { buildPushPayload } = await import("@/lib/push/payload");
    const base = { notificationId: REQ, importance: "normal", unread: 1 };
    expect(buildPushPayload({ ...base, type: "requisition.submitted", link: `/requisitions/${REQ}` }).url).toBe(`/requisitions/${REQ}`);
    expect(buildPushPayload({ ...base, type: "purchase_order.issued", link: `/requisitions/${REQ}` }).url).toBe(`/requisitions/${REQ}`);
    expect(buildPushPayload({ ...base, type: "receipt.received", link: "/receipts" }).url).toBe("/receipts");
    expect(buildPushPayload({ ...base, type: "requisition.submitted", link: "https://evil.example/x" }).url).toBe("/notifications");
  });
});
