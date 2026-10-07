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

const listTestPushTargets = vi.fn();
const sendTestPush = vi.fn();
vi.mock("@/app/(app)/notifications/push-test-actions", () => ({
  listTestPushTargets: () => listTestPushTargets(),
  sendTestPush: (id: string) => sendTestPush(id),
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

describe("TEMPORARY administrator self-test control", () => {
  const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
  const devices = [{ id: "d1", label: "iPhone · Safari", created_at: "2026-10-01T00:00:00Z", last_success_at: null, this_device: false }];
  beforeEach(() => {
    listTestPushTargets.mockReset();
    sendTestPush.mockReset();
    listTestPushTargets.mockResolvedValue({ ok: true, data: [{ id: REQ, requisition_number: "TKT-REQ-2026-0002", submitted_at: "2026-10-07T20:03:43Z" }] });
    permission = "granted";
    getPushStatus.mockImplementation(async () => status({ devices }));
  });
  const renderAs = (selfTest: boolean) => render(<ToastProvider><PushSettings selfTest={selfTest} /></ToastProvider>);

  it("is not shown to non-administrators", async () => {
    renderAs(false);
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.grantedOff));
    expect(screen.queryByTestId("push-self-test")).toBeNull();
    expect(listTestPushTargets).not.toHaveBeenCalled();
  });

  it("is not shown when the administrator has no registered device, or push isn't configured", async () => {
    getPushStatus.mockImplementation(async () => status({ devices: [] }));
    const { unmount } = renderAs(true);
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.grantedOff));
    expect(screen.queryByTestId("push-self-test")).toBeNull();
    unmount();
    getPushStatus.mockImplementation(async () => status({ configured: false, devices }));
    renderAs(true);
    await waitFor(() => expect(statusText()).toBe(PUSH_COPY.notConfigured));
    expect(screen.queryByTestId("push-self-test")).toBeNull();
  });

  it("uses a controlled requisition picker, sends once, and is disabled while sending", async () => {
    let finish!: (v: unknown) => void;
    sendTestPush.mockImplementation(() => new Promise((r) => { finish = r; }));
    renderAs(true);
    const select = (await screen.findByLabelText("Requisition to open")) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: "TKT-REQ-2026-0002" })).toBeTruthy());
    const button = screen.getByRole("button", { name: "Send test notification" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // nothing chosen yet
    fireEvent.change(select, { target: { value: REQ } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sending/ })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Sending/ })); // double tap while pending
    expect(sendTestPush).toHaveBeenCalledTimes(1);
    expect(sendTestPush).toHaveBeenCalledWith(REQ);
    await act(async () => finish({ ok: true, data: { devices: 1, sent: 1 }, message: "Test notification sent to 1 device. Tap it on your phone." }));
    expect(screen.getAllByText("Test notification sent to 1 device. Tap it on your phone.").length).toBeGreaterThan(0);
  });

  it("shows a server refusal (e.g. rate limit) without crashing", async () => {
    sendTestPush.mockResolvedValue({ ok: false, error: "A test notification was sent recently. Please wait a minute before sending another." });
    renderAs(true);
    const select = await screen.findByLabelText("Requisition to open");
    await screen.findByRole("option", { name: "TKT-REQ-2026-0002" }); // wait for the picker to load
    fireEvent.change(select, { target: { value: REQ } });
    fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
    expect((await screen.findAllByText(/sent recently/)).length).toBeGreaterThan(0);
  });
});
