// @vitest-environment jsdom
/**
 * The app follows a tapped notification's remembered destination when it
 * starts, resumes or changes page — the iOS fallback — only for fresh,
 * allowlisted paths, once, and never on sign-in/public pages (so the
 * destination survives signing in).
 */
import { routerMock } from "./setup";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_LINK_CACHE, PENDING_LINK_KEY, PENDING_LINK_MAX_AGE_MS, SW_UPDATE_INTERVAL_MS, ServiceWorkerRegistration, takePendingNotificationLink,
} from "@/components/pwa/service-worker-registration";

const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
let store: Map<string, string>;
function remember(url: unknown, at = Date.now()) { store.set(PENDING_LINK_KEY, JSON.stringify({ url, at })); }
beforeEach(() => {
  store = new Map();
  (globalThis as { caches?: unknown }).caches = {
    open: async (name: string) => {
      if (name !== PENDING_LINK_CACHE) throw new Error("unexpected cache");
      return {
        match: async (k: string) => (store.has(k) ? new Response(store.get(k)) : undefined),
        put: async (k: string, r: Response) => { store.set(k, await r.text()); },
        delete: async (k: string) => store.delete(k),
      };
    },
  };
  window.history.replaceState(null, "", "/dashboard");
});
afterEach(() => { delete (globalThis as { caches?: unknown }).caches; });

describe("takePendingNotificationLink", () => {
  it("returns a fresh requisition destination once, then nothing", async () => {
    remember(`/requisitions/${REQ}`);
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBe(`/requisitions/${REQ}`);
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBeNull();
  });

  it("keeps it on sign-in and public pages so it is followed after signing in", async () => {
    remember(`/requisitions/${REQ}`);
    for (const p of ["/login", "/auth/callback", "/forgot-password", "/request/abc", "/notifications/xyz", "/offline"]) {
      await expect(takePendingNotificationLink(p)).resolves.toBeNull();
    }
    expect(store.has(PENDING_LINK_KEY)).toBe(true);
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBe(`/requisitions/${REQ}`);
  });

  it.each([
    ["external URL", "https://evil.example/requisitions/x"],
    ["protocol-relative", "//evil.example"],
    ["unknown in-app path", "/admin/users"],
    ["not a string", 42],
  ])("rejects and clears an invalid destination (%s)", async (_l, url) => {
    remember(url);
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBeNull();
    expect(store.has(PENDING_LINK_KEY)).toBe(false);
  });

  it("ignores a stale destination and one already on screen", async () => {
    remember(`/requisitions/${REQ}`, Date.now() - PENDING_LINK_MAX_AGE_MS - 1);
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBeNull();
    remember(`/requisitions/${REQ}`);
    await expect(takePendingNotificationLink(`/requisitions/${REQ}`)).resolves.toBeNull();
    expect(store.has(PENDING_LINK_KEY)).toBe(false);
  });

  it("never throws without Cache Storage", async () => {
    delete (globalThis as { caches?: unknown }).caches;
    await expect(takePendingNotificationLink("/dashboard")).resolves.toBeNull();
  });
});

describe("ServiceWorkerRegistration", () => {
  it("cold start / resume: routes to the remembered requisition (iOS fallback)", async () => {
    remember(`/requisitions/${REQ}`);
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/requisitions/${REQ}`));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });

  it("coming back to the foreground picks up a destination remembered while in the background", async () => {
    render(<ServiceWorkerRegistration />);
    await new Promise((r) => setTimeout(r, 0));
    expect(routerMock.push).not.toHaveBeenCalled();
    remember("/receipts");
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/receipts"));
  });

  it("does nothing on the sign-in page (destination kept for after sign-in)", async () => {
    window.history.replaceState(null, "", "/login");
    remember(`/requisitions/${REQ}`);
    render(<ServiceWorkerRegistration />);
    await new Promise((r) => setTimeout(r, 10));
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(store.has(PENDING_LINK_KEY)).toBe(true);
  });

  it("follows a destination stored just AFTER the app appeared (iOS ordering), only once", async () => {
    render(<ServiceWorkerRegistration />);
    await new Promise((r) => setTimeout(r, 100));
    remember(`/requisitions/${REQ}`); // the worker's notificationclick runs after the app is already visible
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/requisitions/${REQ}`), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1500));
    expect(routerMock.push).toHaveBeenCalledTimes(1);
  });
});

describe("service worker updates", () => {
  afterEach(() => { vi.unstubAllEnvs(); delete (navigator as { serviceWorker?: unknown }).serviceWorker; });
  function fakeContainer() {
    const update = vi.fn(async () => undefined);
    const container = {
      register: vi.fn(async () => ({ update })),
      getRegistration: vi.fn(async () => ({ update })),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), startMessages: vi.fn(),
    };
    Object.defineProperty(navigator, "serviceWorker", { value: container, configurable: true });
    return { container, update };
  }

  it("checks for a newer worker on start and when the app returns to the foreground (throttled), without reloading", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container, update } = fakeContainer();
    const now = vi.spyOn(Date, "now");
    let t = 1_000_000;
    now.mockImplementation(() => t);
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    document.dispatchEvent(new Event("visibilitychange")); // too soon: throttled
    await new Promise((r) => setTimeout(r, 10));
    expect(update).toHaveBeenCalledTimes(1);
    t += SW_UPDATE_INTERVAL_MS + 1;
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    now.mockRestore();
    // No reload anywhere in the update path (no reload loops).
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("components/pwa/service-worker-registration.tsx", "utf8")).not.toMatch(/location\.reload|\.reload\(/);
  });

  it("re-checks for a remembered destination when the new worker takes control", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { container } = fakeContainer();
    render(<ServiceWorkerRegistration />);
    await waitFor(() => expect(container.addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function)));
  });
});

describe("training diagnostics panel", () => {
  it("shows the worker build, last tap steps and app pickup without ids; only rendered in training mode", async () => {
    const { PushDiagnostics } = await import("@/components/notifications/push-diagnostics");
    store.set("/__tkt/diag-worker", JSON.stringify({ build: "2026-10-08.3", activatedAt: Date.now() }));
    store.set("/__tkt/diag-last-tap", JSON.stringify({ build: "2026-10-08.3", at: Date.now(), page: "requisition detail", hadData: true, windows: 1, exact: false, navigate: "missing", messaged: true, opened: true }));
    localStorage.setItem("tkt:diag-pickup", JSON.stringify({ at: Date.now(), result: "followed", page: "requisition detail" }));
    const { findByText, container } = render(<PushDiagnostics />);
    expect(await findByText(/Training diagnostics/)).toBeTruthy();
    expect(container.textContent).toMatch(/2026-10-08\.3/);
    expect(container.textContent).toMatch(/navigate missing · message true · openWindow true/);
    expect(container.textContent).toMatch(/followed · requisition detail/);
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/(app)/notifications/page.tsx", "utf8")).toMatch(/isTrainingMode\(\) \? <PushDiagnostics \/> : null/);
  });

  it("records the app's pickup result for a followed destination", async () => {
    remember(`/requisitions/${REQ}`);
    await takePendingNotificationLink("/dashboard");
    expect(JSON.parse(localStorage.getItem("tkt:diag-pickup")!)).toMatchObject({ result: "followed", page: "requisition detail" });
  });
});
