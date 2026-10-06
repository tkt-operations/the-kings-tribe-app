// @vitest-environment jsdom
import { routerMock } from "./setup";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_DURATION, ToastProvider, useToast } from "@/components/ui/toast";

void routerMock;

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Changes saved successfully.")}>ok</button>
      <button onClick={() => toast.error("Unable to save changes. Please try again.")}>fail</button>
    </>
  );
}

afterEach(() => vi.useRealTimers());

describe("toasts", () => {
  it("announces success politely and errors assertively", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("fail"));
    expect(within(screen.getByRole("status")).getByText("Changes saved successfully.")).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText("Unable to save changes. Please try again.")).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");
  });

  it("stays long enough to read, then dismisses itself", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    expect(TOAST_DURATION.success).toBeGreaterThanOrEqual(5000);
    act(() => vi.advanceTimersByTime(TOAST_DURATION.success - 500));
    expect(screen.queryByText("Changes saved successfully.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(600));
    expect(screen.queryByText("Changes saved successfully.")).toBeNull();
  });

  it("pauses while hovered and can be dismissed manually", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText("fail"));
    const toast = screen.getByText("Unable to save changes. Please try again.").closest("[data-tone]")!;
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(TOAST_DURATION.error * 2));
    expect(screen.queryByText("Unable to save changes. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Unable to save changes. Please try again.")).toBeNull();
  });

  it("collapses an identical message triggered twice", () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText("ok"));
    fireEvent.click(screen.getByText("ok"));
    expect(screen.getAllByText("Changes saved successfully.")).toHaveLength(1);
  });

  it("shows a queued flash message after a redirect and clears the cookie", () => {
    document.cookie = "tkt_flash=admin-created; Path=/";
    render(<ToastProvider><p>page</p></ToastProvider>);
    expect(screen.getByText("Administrator account created successfully.")).toBeTruthy();
    expect(document.cookie).not.toContain("tkt_flash=admin-created");
  });

  it("ignores unknown flash keys", () => {
    document.cookie = "tkt_flash=%3Cimg%20src%3Dx%3E; Path=/";
    render(<ToastProvider><p>page</p></ToastProvider>);
    expect(within(screen.getByRole("status")).queryByText(/img/)).toBeNull();
  });
});
