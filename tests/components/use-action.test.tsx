// @vitest-environment jsdom
import { routerMock } from "./setup";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoadingButton } from "@/components/ui/submit-button";
import { ToastProvider } from "@/components/ui/toast";
import { GENERIC_ERROR, useAction } from "@/components/ui/use-action";
import type { ActionResult } from "@/lib/action-result";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness({ action, successMessage }: { action: () => Promise<ActionResult>; successMessage?: string }) {
  const { pending, error, run } = useAction();
  return (
    <div>
      <LoadingButton pending={pending} pendingLabel="Saving…" onClick={() => run(action, { successMessage })}>Save</LoadingButton>
      {error ? <p data-testid="form-error">{error}</p> : null}
    </div>
  );
}

const renderHarness = (action: () => Promise<ActionResult>, successMessage?: string) =>
  render(<ToastProvider><Harness action={action} successMessage={successMessage} /></ToastProvider>);

describe("useAction feedback", () => {
  it("shows a success toast and refreshes the route", async () => {
    const action = vi.fn(async (): Promise<ActionResult> => ({ ok: true, data: undefined }));
    renderHarness(action, "Purchase order created successfully.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(screen.getByRole("status")).findByText("Purchase order created successfully.")).toBeTruthy();
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("prefers the server's message when it sends one", async () => {
    renderHarness(async () => ({ ok: true, data: undefined, message: "Receipt reconciled successfully." }), "fallback");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Receipt reconciled successfully.")).toBeTruthy();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("shows an error toast and a form-level message on failure", async () => {
    renderHarness(async () => ({ ok: false, error: "That record already exists." }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await within(screen.getByRole("alert")).findByText("That record already exists.")).toBeTruthy();
    expect(screen.getByTestId("form-error").textContent).toBe("That record already exists.");
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });

  it("replaces unexpected exceptions with a safe generic message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    renderHarness(async () => {
      throw new Error("FetchError: connect ECONNREFUSED 10.0.0.5:5432 (postgres://admin:secret@db)");
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findAllByText(GENERIC_ERROR)).not.toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/ECONNREFUSED|postgres|secret/);
    consoleError.mockRestore();
  });

  it("blocks duplicate submissions, shows a loading state, and restores the button after failure", async () => {
    const pending = deferred<ActionResult>();
    const action = vi.fn(() => pending.promise);
    renderHarness(action);
    const button = screen.getByRole("button", { name: "Save" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true));
    expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");

    await act(async () => pending.resolve({ ok: false, error: "Unable to save changes. Please try again." }));
    const restored = await screen.findByRole("button", { name: "Save" });
    expect(restored).toHaveProperty("disabled", false);

    fireEvent.click(restored);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
