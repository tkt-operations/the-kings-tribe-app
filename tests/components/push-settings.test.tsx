// @vitest-environment jsdom
/** "Phone notifications" settings: every permission/subscription state, and that permission is only requested on a click. */
import "./setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { PushStatus } from "@/app/(app)/notifications/push-actions";

const getPushStatus = vi.fn<(endpoint: string | null) => Promise<ActionResult<PushStatus>>>();
const savePushSubscription = vi.fn<(input: unknown) => Promise<ActionResult<{ transferred: boolean }>>>();
const removePushSubscription = vi.fn<(endpoint: string) => Promise<ActionResult>>();
const removePushDevice = vi.fn<(id: string) => Promise<ActionResult>>();
const setPushLevel = vi.fn<(level: string) => Promise<ActionResult<{ pushLevel: "important" | "actionable" }>>>();
vi.mock("@/app/(app)/notifications/push-actions", () => ({
  getPushStatus: (e: string | null) => getPushStatus(e),
  savePushSubscription: (i: unknown) => savePushSubscription(i),
  removePushSubscription: (e: string) => removePushSubscription(e),
  removePushDevice: (id: string) => removePushDevice(id),
  setPushLevel: (l: string) => setPushLevel(l),
}));

const { PushSettings, PUSH_COPY } = await import("@/components/notifications/push-settings");

const KEY = "BAbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjK";
const EP = "https://fcm.googleapis.com/fcm/send/this-device";
let browserSub: { endpoint: string; options: { applicationServerKey: null }; toJSON: () => unknown; unsubscribe: ReturnType<typeof vi.fn> } | null;
const subscribe = vi.fn();
const requestPermission = vi.fn();
let permission: NotificationPermission;

function makeSub(endpoint = EP) {
  return { endpoint, options: { applicationServerKey: null }, toJSON: () => ({ endpoint, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) } }), unsubscribe: vi.fn(async () => true) };
}
const status = (over: Partial<PushStatus> = {}): ActionResult<PushStatus> => ({ ok: true, data: { configured: true, thisDevice: false, pushLevel: "actionable", devices: [], ...over } });

function installBrowser({ push = true }: { push?: boolean } = {}) {
  const registration = { pushManager: { getSubscription: vi.fn(async () => browserSub), subscribe } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: vi.fn(async () => registration), ready: Promise.resolve(registration) } });
  if (push) (window as unknown as Record<string, unknown>).PushManager = function PushManager() {};
  else delete (window as unknown as Record<string, unknown>).PushManager;
  (window as unknown as Record<string, unknown>).Notification = { get permission() { return permission; }, requestPermission };
}

const renderSettings = () => render(<ToastProvider><PushSettings /></ToastProvider>);
const statusText = () => document.getElementById("push-settings-status")?.textContent ?? "";

beforeEach(() => {
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = KEY;
  browserSub = null;
  permission = "default";
  subscribe.mockReset();
  requestPermission.mockReset();
  subscribe.mockImplementation(async () => (browserSub = makeSub()));
  getPushStatus.mockReset();
  getPushStatus.mockImplementation(async (endpoint) => status({ thisDevice: endpoint === EP && Boolean(browserSub) }));
  savePushSubscription.mockResolvedValue({ ok: true, data: { transferred: false }, message: "Phone notifications are on for this device." });
  removePushSubscription.mockResolvedValue({ ok: true, data: undefined, message: "Phone notifications are off for this device." });
  removePushDevice.mockResolvedValue({ ok: true, data: undefined, message: "Device removed." });
  setPushLevel.mockImplementation(async (l) => ({ ok: true, data: { pushLevel: l as "important" | "actionable" }, message: "Saved." }));
  installBrowser();
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

describe("phone notification states", () => {
  it("VAPID not configured: explains, offers nothing, never asks for permission", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.notConfigured));
    expect(screen.queryByRole("button", { name: /Enable phone notifications/ })).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("server reports push not configured", async () => {
    getPushStatus.mockResolvedValue(status({ configured: false }));
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.notConfigured));
  });

  it("unsupported browser", async () => {
    installBrowser({ push: false });
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.unsupported));
  });

  it("iPhone Safari outside the Home Screen app is told to install first", async () => {
    delete (window as unknown as Record<string, unknown>).PushManager;
    delete (window as unknown as Record<string, unknown>).Notification;
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1");
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.iosInstall));
    ua.mockRestore();
  });

  it("default permission: explains first, asks ONLY when the button is pressed, then subscribes and saves", async () => {
    renderSettings();
    const button = await screen.findByRole("button", { name: "Enable phone notifications" });
    expect(screen.getByText(PUSH_COPY.intro)).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
    requestPermission.mockImplementation(async () => (permission = "granted"));
    fireEvent.click(button);
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.on));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: expect.any(Uint8Array) });
    expect(savePushSubscription).toHaveBeenCalledWith({ endpoint: EP, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, label: expect.any(String) });
    expect(screen.getByRole("button", { name: "Turn off for this device" })).toBeTruthy();
  });

  it("permission denied at the prompt: nothing is saved and the app carries on", async () => {
    renderSettings();
    requestPermission.mockImplementation(async () => (permission = "denied"));
    fireEvent.click(await screen.findByRole("button", { name: "Enable phone notifications" }));
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.denied));
    expect(subscribe).not.toHaveBeenCalled();
    expect(savePushSubscription).not.toHaveBeenCalled();
  });

  it("previously denied: explains how to allow it, no button", async () => {
    permission = "denied";
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.denied));
    expect(screen.queryByRole("button", { name: /Enable|Turn on/ })).toBeNull();
  });

  it("already granted but not subscribed (or expired): turns on without prompting again", async () => {
    permission = "granted";
    renderSettings();
    const button = await screen.findByRole("button", { name: "Turn on for this device" });
    expect(statusText()).toBe(PUSH_COPY.grantedOff);
    fireEvent.click(button);
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.on));
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("a browser subscription that belongs to someone else is only moved when this user turns it on", async () => {
    permission = "granted";
    browserSub = makeSub();
    getPushStatus.mockImplementationOnce(async () => status({ thisDevice: false }));
    savePushSubscription.mockResolvedValueOnce({ ok: true, data: { transferred: true } });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on for this device" }));
    await waitFor(() => expect(screen.getByText(/moved to your account/)).toBeTruthy());
    expect(subscribe).not.toHaveBeenCalled(); // reuses the browser's existing subscription
  });

  it("subscribed: turn off, change the preference, and remove another device", async () => {
    permission = "granted";
    browserSub = makeSub();
    const devices = [
      { id: "d1", label: "iPhone · Safari", created_at: "2026-10-01T00:00:00Z", last_success_at: null, this_device: true },
      { id: "d2", label: "Mac · Chrome", created_at: "2026-10-02T00:00:00Z", last_success_at: null, this_device: false },
    ];
    getPushStatus.mockImplementation(async (e) => status({ thisDevice: e === EP && Boolean(browserSub), devices }));
    renderSettings();
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.on));
    expect(screen.getByText(PUSH_COPY.signOut)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Important only/ }));
    await waitFor(() => expect(setPushLevel).toHaveBeenCalledWith("important"));
    fireEvent.click(screen.getByRole("button", { name: "Remove Mac · Chrome" }));
    await waitFor(() => expect(removePushDevice).toHaveBeenCalledWith("d2"));
    const sub = browserSub!;
    fireEvent.click(screen.getByRole("button", { name: "Turn off for this device" }));
    await waitFor(() => expect(removePushSubscription).toHaveBeenCalledWith(EP));
    expect(sub.unsubscribe).toHaveBeenCalled();
  });

  it("a failed save is reported and leaves the page usable", async () => {
    permission = "granted";
    savePushSubscription.mockResolvedValueOnce({ ok: false, error: "Phone notifications could not be turned on. Please try again." });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Turn on for this device" }));
    await screen.findByText("Phone notifications could not be turned on. Please try again.");
    await act(async () => {});
    expect(screen.getByRole("button", { name: "Turn on for this device" })).toBeTruthy();
  });
});
