// @vitest-environment jsdom
/**
 * The app follows a tapped notification's remembered destination when it
 * starts, resumes or changes page — the iOS fallback — only for fresh,
 * allowlisted paths, once, and never on sign-in/public pages (so the
 * destination survives signing in).
 */
import { routerMock } from "./setup";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PENDING_LINK_CACHE, PENDING_LINK_KEY, PENDING_LINK_MAX_AGE_MS, ServiceWorkerRegistration, takePendingNotificationLink,
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
});
