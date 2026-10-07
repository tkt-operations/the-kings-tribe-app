// @vitest-environment jsdom
/** TEMPORARY email delivery self-test card: one call per press, disabled while sending, status labels only. */
import "./setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import type { SelfTestStatus } from "@/lib/email/self-test";

const sendTestEmailToMyself = vi.fn<() => Promise<ActionResult>>();
const getTestEmailStatus = vi.fn<() => Promise<ActionResult<SelfTestStatus | null>>>();
vi.mock("@/app/(app)/admin/settings/email-test-actions", () => ({
  sendTestEmailToMyself: (...a: unknown[]) => (sendTestEmailToMyself as (...x: unknown[]) => Promise<ActionResult>)(...a),
  getTestEmailStatus: () => getTestEmailStatus(),
}));
const { EmailSelfTest } = await import("@/app/(app)/admin/settings/email-self-test");

const renderCard = () => render(<ToastProvider><EmailSelfTest timezone="UTC" /></ToastProvider>);
const status = () => screen.getByTestId("email-self-test-status").textContent ?? "";

beforeEach(() => {
  sendTestEmailToMyself.mockReset();
  getTestEmailStatus.mockReset().mockResolvedValue({ ok: true, data: null });
});

describe("email delivery self-test card", () => {
  it("is labelled as a temporary diagnostic", async () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Send test email to myself" })).toBeTruthy();
    expect(screen.getByText("(temporary diagnostic)")).toBeTruthy();
    await waitFor(() => expect(status()).toContain("No test email sent yet."));
  });

  it("sends with no arguments, once per press, and is disabled while sending", async () => {
    let resolve!: (r: ActionResult) => void;
    sendTestEmailToMyself.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderCard();
    const button = screen.getByRole("button", { name: "Send test email to myself" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect((screen.getByRole("button", { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(sendTestEmailToMyself).toHaveBeenCalledTimes(1);
    expect(sendTestEmailToMyself).toHaveBeenCalledWith();
    getTestEmailStatus.mockResolvedValue({ ok: true, data: { sentAt: "2026-10-07T23:00:00Z", app: "Accepted by Resend", provider: null, tone: "neutral", providerAt: null, events: [] } });
    await act(async () => resolve({ ok: true, data: undefined, message: "Test email accepted for delivery. Check your inbox." }));
    await screen.findByText("Test email accepted for delivery. Check your inbox.");
    await waitFor(() => expect(status()).toContain("No delivery update yet"));
    expect(status()).not.toContain("Delivered");
  });

  it("shows a server refusal (e.g. the rate limit) and stays usable", async () => {
    sendTestEmailToMyself.mockResolvedValue({ ok: false, error: "A test email was sent recently. Please wait 10 minutes before sending another." });
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Send test email to myself" }));
    await screen.findByText(/sent recently/);
    expect((screen.getByRole("button", { name: "Send test email to myself" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the provider-derived state once the webhook has recorded it", async () => {
    getTestEmailStatus.mockResolvedValue({ ok: true, data: { sentAt: "2026-10-07T23:00:00Z", app: "Accepted by Resend", provider: "Delivered", tone: "positive", providerAt: "2026-10-07T23:00:04Z", events: [] } });
    renderCard();
    await waitFor(() => expect(status()).toContain("Provider status: Delivered"));
    expect(status()).not.toContain("No delivery update yet");
    fireEvent.click(screen.getByRole("button", { name: "Check delivery status" }));
    await waitFor(() => expect(getTestEmailStatus).toHaveBeenCalledTimes(2));
  });
});
