// @vitest-environment jsdom
/** The app routes itself when the service worker cannot navigate an open window (iOS PWA). */
import { routerMock } from "./setup";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { ServiceWorkerRegistration, SW_NAVIGATE_MESSAGE } = await import("@/components/pwa/service-worker-registration");

const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
let container: EventTarget & { startMessages: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> };

beforeEach(() => {
  routerMock.push.mockReset();
  const target = new EventTarget();
  container = Object.assign(target, { startMessages: vi.fn(), register: vi.fn(async () => ({})) });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
});

const send = (data: unknown, origin = window.location.origin) =>
  act(async () => { container.dispatchEvent(new MessageEvent("message", { data, origin })); });

describe("service worker navigate messages", () => {
  it("routes to the exact allowlisted path from the notification", async () => {
    render(<ServiceWorkerRegistration />);
    expect(container.startMessages).toHaveBeenCalled();
    await send({ type: SW_NAVIGATE_MESSAGE, url: `/requisitions/${REQ}` });
    expect(routerMock.push).toHaveBeenCalledWith(`/requisitions/${REQ}`);
    for (const path of ["/receipts", "/dashboard"]) {
      await send({ type: SW_NAVIGATE_MESSAGE, url: path });
      expect(routerMock.push).toHaveBeenLastCalledWith(path);
    }
  });

  it.each([
    [{ type: SW_NAVIGATE_MESSAGE, url: "https://evil.example.com/" }],
    [{ type: SW_NAVIGATE_MESSAGE, url: "//evil.example.com" }],
    [{ type: SW_NAVIGATE_MESSAGE, url: "javascript:alert(1)" }],
    [{ type: SW_NAVIGATE_MESSAGE, url: "/requisitions/not-a-uuid" }],
    [{ type: SW_NAVIGATE_MESSAGE, url: "/admin/users" }],
    [{ type: "other", url: "/receipts" }],
    [null],
    ["/receipts"],
  ])("ignores unsafe or unrelated messages %j", async (data) => {
    render(<ServiceWorkerRegistration />);
    await send(data);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("ignores messages from another origin and does not re-navigate to the current page", async () => {
    render(<ServiceWorkerRegistration />);
    await send({ type: SW_NAVIGATE_MESSAGE, url: "/receipts" }, "https://evil.example.com");
    expect(routerMock.push).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/receipts");
    await send({ type: SW_NAVIGATE_MESSAGE, url: "/receipts" });
    expect(routerMock.push).not.toHaveBeenCalled();
    window.history.replaceState(null, "", "/");
  });

  it("stops listening when unmounted", async () => {
    const { unmount } = render(<ServiceWorkerRegistration />);
    unmount();
    await send({ type: SW_NAVIGATE_MESSAGE, url: "/receipts" });
    expect(routerMock.push).not.toHaveBeenCalled();
  });
});
