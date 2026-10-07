// @vitest-environment jsdom
/**
 * Notification bell + panel (inside the real app shell), the /notifications
 * list, and Needs Attention. Server actions and Supabase Realtime are mocked.
 */
import { routerMock } from "./setup";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/action-result";
import type { UserNotification } from "@/lib/notifications/types";
import { ToastProvider } from "@/components/ui/toast";

const loadNotificationPanel = vi.fn<() => Promise<ActionResult<{ unread: number; items: UserNotification[] }>>>();
const loadUnreadCount = vi.fn<() => Promise<ActionResult<number>>>();
const markNotificationRead = vi.fn<(id: string) => Promise<ActionResult<{ unread: number }>>>();
const markAllNotificationsRead = vi.fn<() => Promise<ActionResult<{ unread: number }>>>();
vi.mock("@/app/(app)/notifications/actions", () => ({
  loadNotificationPanel: () => loadNotificationPanel(),
  loadUnreadCount: () => loadUnreadCount(),
  markNotificationRead: (id: string) => markNotificationRead(id),
  markAllNotificationsRead: () => markAllNotificationsRead(),
}));

let realtimeHandler: (() => void) | null = null;
let realtimeFilter: string | null = null;
let realtimeThrows = false;
const removeChannel = vi.fn();
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => {
    if (realtimeThrows) throw new Error("Realtime unavailable");
    return {
      channel: () => {
        const ch = {
          on: (_type: string, opts: { filter: string }, handler: () => void) => {
            realtimeFilter = opts.filter;
            realtimeHandler = handler;
            return ch;
          },
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel,
    };
  },
}));

const { AppShell } = await import("@/components/shell/app-shell");
const { NotificationList } = await import("@/app/(app)/notifications/notification-list");
const { NeedsAttention } = await import("@/components/dashboard/needs-attention");

const REQ = "0b6f0f9e-1c2d-4e3f-8a9b-0c1d2e3f4a5b";
const note = (over: Partial<UserNotification> = {}): UserNotification => ({
  id: crypto.randomUUID(), type: "requisition.submitted", category: "requisitions", importance: "normal",
  title: "New requisition requires review", body: "TKT-REQ-2026-0002 · Production Team", link: `/requisitions/${REQ}`,
  requisition_id: REQ, read_at: null, created_at: new Date(Date.now() - 5 * 60_000).toISOString(), ...over,
});

function renderShell(unread = 3) {
  return render(
    <AppShell nav={[]} user={{ fullName: "Avery Finance", email: "avery@example.org", roleNames: ["Administrator"] }} notifications={{ userId: "user-1", unread, timeZone: "America/Chicago" }}>
      <p>Page</p>
    </AppShell>,
  );
}
const bells = () => screen.getAllByRole("button", { name: /^Notifications,/ });
const panel = () => screen.getByRole("dialog", { name: /Notifications/ });

beforeEach(() => {
  realtimeHandler = null;
  realtimeFilter = null;
  realtimeThrows = false;
  routerMock.push.mockReset();
  loadUnreadCount.mockResolvedValue({ ok: true, data: 3 });
  markNotificationRead.mockResolvedValue({ ok: true, data: { unread: 2 } });
  markAllNotificationsRead.mockResolvedValue({ ok: true, data: { unread: 0 } });
  loadNotificationPanel.mockResolvedValue({ ok: true, data: { unread: 3, items: [note(), note({ title: "Receipt ready to reconcile", category: "purchasing", importance: "high" }), note({ title: "Requisition closed", read_at: new Date().toISOString() })] } });
});
afterEach(() => vi.useRealTimers());

describe("bell", () => {
  it("appears in the desktop sidebar and mobile header with an accessible unread label and 9+ cap", () => {
    renderShell(12);
    expect(bells()).toHaveLength(2);
    for (const b of bells()) {
      expect(b.getAttribute("aria-label")).toBe("Notifications, 12 unread");
      expect(b.getAttribute("aria-haspopup")).toBe("dialog");
      expect(b.className).toContain("size-11"); // 44 px touch target
      expect(within(b).getByText("9+")).toBeTruthy();
    }
  });

  it("shows no badge with nothing unread", () => {
    renderShell(0);
    expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, no unread");
    expect(within(bells()[0]).queryByText("0")).toBeNull();
  });

  it("opening the panel lists recent notifications and marks NOTHING read", async () => {
    renderShell();
    fireEvent.click(bells()[0]);
    await waitFor(() => expect(within(panel()).getByText("Receipt ready to reconcile")).toBeTruthy());
    expect(bells()[0].getAttribute("aria-expanded")).toBe("true");
    expect(markNotificationRead).not.toHaveBeenCalled();
    expect(markAllNotificationsRead).not.toHaveBeenCalled();
    expect(within(panel()).getAllByText("Important")).toHaveLength(1);
    expect(within(panel()).getAllByText("5 minutes ago")).toHaveLength(3);
    expect(within(panel()).getByRole("link", { name: "View all notifications" }).getAttribute("href")).toBe("/notifications");
  });

  it("selecting a notification marks it read and opens its safe link", async () => {
    renderShell();
    fireEvent.click(bells()[0]);
    const link = await within(await screen.findByRole("dialog", { name: /Notifications/ })).findByRole("link", { name: /New requisition requires review/ });
    expect(link.getAttribute("href")).toBe(`/requisitions/${REQ}`);
    fireEvent.click(link);
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/requisitions/${REQ}`));
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: /Notifications/ })).toBeNull();
  });

  it("never navigates to an unsafe link", async () => {
    loadNotificationPanel.mockResolvedValue({ ok: true, data: { unread: 1, items: [note({ title: "Odd", link: "https://evil.example.com/" })] } });
    renderShell(1);
    fireEvent.click(bells()[0]);
    const link = await within(await screen.findByRole("dialog", { name: /Notifications/ })).findByRole("link", { name: /Odd/ });
    expect(link.getAttribute("href")).toBe("/notifications");
    fireEvent.click(link);
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/notifications"));
  });

  it("per-item Mark as read and Mark all as read update the count", async () => {
    renderShell();
    fireEvent.click(bells()[0]);
    const p = await screen.findByRole("dialog", { name: /Notifications/ });
    fireEvent.click(await within(p).findByRole("button", { name: 'Mark "New requisition requires review" as read' }));
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, 2 unread"));
    expect(routerMock.push).not.toHaveBeenCalled();
    fireEvent.click(within(p).getByRole("button", { name: /Mark all as read/ }));
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, no unread"));
    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    expect((within(p).getByRole("button", { name: /Mark all as read/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is keyboard friendly: focus moves into the panel, Escape closes it and returns focus to the bell", async () => {
    renderShell();
    const bell = bells()[1];
    bell.focus();
    fireEvent.click(bell);
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Notifications"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /Notifications/ })).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it("shows an empty state and a retry on errors", async () => {
    loadNotificationPanel.mockResolvedValueOnce({ ok: false, error: "Notifications could not be loaded." });
    renderShell();
    fireEvent.click(bells()[0]);
    const p = await screen.findByRole("dialog", { name: /Notifications/ });
    await within(p).findByText("Notifications could not be loaded.");
    loadNotificationPanel.mockResolvedValueOnce({ ok: true, data: { unread: 0, items: [] } });
    fireEvent.click(within(p).getByRole("button", { name: "Try again" }));
    await within(p).findByText(/all caught up/);
  });

  it("panel fits the phone width (fixed inset) and pins beside the sidebar on desktop", async () => {
    renderShell();
    fireEvent.click(bells()[0]);
    const p = await screen.findByRole("dialog", { name: /Notifications/ });
    expect(p.className).toContain("inset-x-2");
    expect(p.className).toContain("lg:w-[24rem]");
    expect(p.className).toContain("overflow-hidden");
  });
});

describe("live updates", () => {
  it("subscribes to the user's own rows and refreshes the count on a Realtime event", async () => {
    renderShell(3);
    expect(realtimeFilter).toBe("user_id=eq.user-1");
    loadUnreadCount.mockResolvedValue({ ok: true, data: 5 });
    await act(async () => realtimeHandler?.());
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, 5 unread"));
  });

  it("works without Realtime: refreshes on focus and polls every 60 seconds while visible", async () => {
    realtimeThrows = true;
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderShell(3);
    loadUnreadCount.mockResolvedValue({ ok: true, data: 4 });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, 4 unread"));
    loadUnreadCount.mockResolvedValue({ ok: true, data: 7 });
    await act(async () => vi.advanceTimersByTime(60_000));
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, 7 unread"));
  });

  it("refreshes when the inbox page announces a change, and cleans up its channel", async () => {
    const { unmount } = renderShell(3);
    loadUnreadCount.mockResolvedValue({ ok: true, data: 0 });
    await act(async () => window.dispatchEvent(new Event("tkt:notifications-changed")));
    await waitFor(() => expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, no unread"));
    unmount();
    expect(removeChannel).toHaveBeenCalled();
  });
});

describe("app badge", () => {
  it("mirrors the unread count where the Badge API exists, and clears at zero", async () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    Object.assign(navigator, { setAppBadge, clearAppBadge });
    renderShell(3);
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3));
    loadUnreadCount.mockResolvedValue({ ok: true, data: 0 });
    await act(async () => window.dispatchEvent(new Event("tkt:notifications-changed")));
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
    delete (navigator as unknown as Record<string, unknown>).setAppBadge;
    delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
  });

  it("works normally where the Badge API is missing", async () => {
    renderShell(2);
    expect(bells()[0].getAttribute("aria-label")).toBe("Notifications, 2 unread");
  });
});

describe("/notifications list", () => {
  const renderList = (rows: UserNotification[]) =>
    render(<ToastProvider><NotificationList rows={rows} now={Date.now()} timeZone="America/Chicago" emptyMessage="No notifications yet." /></ToastProvider>);

  it("marks one read, marks all read, and tells the bell", async () => {
    const changed = vi.fn();
    window.addEventListener("tkt:notifications-changed", changed);
    renderList([note(), note({ title: "Requisition approved — ready for PO" })]);
    fireEvent.click(screen.getByRole("button", { name: 'Mark "New requisition requires review" as read' }));
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Mark all as read/ }));
    await waitFor(() => expect(markAllNotificationsRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole("button", { name: /Mark all as read/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("tkt:notifications-changed", changed);
  });

  it("opening an item marks it read and navigates", async () => {
    renderList([note()]);
    fireEvent.click(screen.getByRole("link", { name: /New requisition requires review/ }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(`/requisitions/${REQ}`));
    expect(markNotificationRead).toHaveBeenCalled();
  });

  it("shows the empty state", () => {
    renderList([]);
    expect(screen.getByText("No notifications yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Mark all as read/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Needs Attention", () => {
  const card = (over: Record<string, unknown> = {}) => ({ key: "awaiting_review" as const, title: "Awaiting review", hint: "Submitted or under review", count: 3, href: "/requisitions?attention=awaiting_review", details: ["1 Essential"], emphasis: true, ...over });

  it("renders a linked card per permitted item with an accessible summary", () => {
    render(<NeedsAttention cards={[card(), card({ key: "receipts_to_reconcile", title: "Receipts to reconcile", count: 2, href: "/receipts", details: ["1 unmatched"], emphasis: false })]} />);
    const review = screen.getByRole("link", { name: "Awaiting review: 3 (1 Essential)" });
    expect(review.getAttribute("href")).toBe("/requisitions?attention=awaiting_review");
    expect(screen.getByRole("link", { name: "Receipts to reconcile: 2 (1 unmatched)" }).getAttribute("href")).toBe("/receipts");
    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeTruthy();
  });

  it("says all caught up when nothing is waiting, and renders nothing without permitted cards", () => {
    const { rerender } = render(<NeedsAttention cards={[card({ count: 0, details: [] })]} />);
    expect(screen.getByText(/all caught up/)).toBeTruthy();
    rerender(<NeedsAttention cards={[]} />);
    expect(screen.queryByRole("heading", { name: "Needs attention" })).toBeNull();
  });
});
