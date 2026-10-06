// @vitest-environment jsdom
/** Administration → Requisition links: Copy link, Replace link, Revoke separation. */
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";

const TOKEN = "Ab3dE9xYz_0123456789abcdefghijklmnopqrstu-v";
const FULL = `https://ops.thekingstribe.org/request/${TOKEN}`;
const replaceFormLink = vi.fn<(id: string) => Promise<ActionResult<{ url: string; oldRevoked: boolean }>>>();
const revokeFormLink = vi.fn<(id: string) => Promise<ActionResult>>();
const createFormLink = vi.fn<(input: unknown) => Promise<ActionResult<{ url: string }>>>();
vi.mock("@/app/(app)/admin/form-links/actions", () => ({
  replaceFormLink: (id: string) => replaceFormLink(id),
  revokeFormLink: (id: string) => revokeFormLink(id),
  createFormLink: (input: unknown) => createFormLink(input),
}));

const { FormLinks, COPY_FAILURE, COPY_SUCCESS } = await import("@/app/(app)/admin/form-links/form-links");

type Link = { id: string; label: string; token_hint: string; department: string | null; expires_at: string | null; max_submissions: number | null; submission_count: number; is_active: boolean; revoked_at: string | null; last_used_at: string | null; created_at: string; expired: boolean };
const link: Link = { id: "00000000-0000-4000-8000-0000000000aa", label: "Production Team", token_hint: "Zz9yX8", department: "Production Team", expires_at: null, max_submissions: null, submission_count: 0, is_active: true, revoked_at: null, last_used_at: null, created_at: "2026-10-06T00:00:00Z", expired: false };
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ops.thekingstribe.org");
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  writeText.mockReset();
  replaceFormLink.mockReset();
  revokeFormLink.mockReset();
  createFormLink.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const renderLinks = (links: Link[] = [link]) => render(<ToastProvider><FormLinks links={links} departments={[]} /></ToastProvider>);
const toastStatus = () => screen.getAllByRole("status").find((el) => el.getAttribute("aria-live") === "polite")!;
const toastAlert = () => screen.getAllByRole("alert").find((el) => el.getAttribute("aria-live") === "assertive")!;

async function replaceAndOpenPanel() {
  replaceFormLink.mockResolvedValue({ ok: true, data: { url: FULL, oldRevoked: true }, message: "Requisition link replaced. The old link no longer works." });
  renderLinks();
  fireEvent.click(screen.getByRole("button", { name: "Replace link for Production Team" }));
  fireEvent.click(screen.getByRole("button", { name: "Replace link" }));
  return screen.findByRole("button", { name: /Copy link/ });
}

describe("requisition link cards", () => {
  it("show only the truncated canonical link, never a full token", () => {
    renderLinks();
    expect(screen.getByText("ops.thekingstribe.org/request/Zz9yX8…")).toBeTruthy();
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("keep Replace (safe) and Revoke (destructive, confirmed) apart", () => {
    renderLinks();
    const replace = screen.getByRole("button", { name: "Replace link for Production Team" });
    const revoke = screen.getByRole("button", { name: "Revoke Production Team" });
    expect(replace.parentElement!.className).toContain("justify-between");
    expect(replace.nextElementSibling).toBe(revoke);
    fireEvent.click(revoke);
    expect(revokeFormLink).not.toHaveBeenCalled(); // needs confirmation
    expect(screen.getByText(/Anyone using it will no longer be able to submit/)).toBeTruthy();
  });

  it("offer no actions on revoked links", () => {
    renderLinks([{ ...link, is_active: false, revoked_at: "2026-10-06T01:00:00Z" }]);
    expect(screen.queryByRole("button", { name: /Replace link/ })).toBeNull();
    expect(screen.getByText("Revoked")).toBeTruthy();
  });
});

describe("Replace link confirmation", () => {
  it("explains the consequence and offers Cancel / Replace link", () => {
    renderLinks();
    fireEvent.click(screen.getByRole("button", { name: "Replace link for Production Team" }));
    expect(screen.getByText(/Replacing this link will revoke the current requisition link\. Anyone using the old link will no longer be able to submit requests\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace link" })).toBeTruthy();
  });

  it("cancelling changes nothing", () => {
    renderLinks();
    fireEvent.click(screen.getByRole("button", { name: "Replace link for Production Team" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(replaceFormLink).not.toHaveBeenCalled();
    expect(revokeFormLink).not.toHaveBeenCalled();
  });

  it("shows success feedback after replacing", async () => {
    await replaceAndOpenPanel();
    expect(await within(toastStatus()).findByText("Requisition link replaced. The old link no longer works.")).toBeTruthy();
  });
});

describe("Copy link", () => {
  it("shows the COMPLETE URL once, copies it, and confirms with a toast", async () => {
    writeText.mockResolvedValue();
    const copy = await replaceAndOpenPanel();
    expect(copy.textContent).toContain("Copy link"); // text, not an icon alone
    expect((screen.getByLabelText("Requisition link") as HTMLInputElement).value).toBe(FULL);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));
    expect(await within(toastStatus()).findByText(COPY_SUCCESS)).toBeTruthy();
    expect(COPY_SUCCESS).toBe("Requisition link copied.");
  });

  it("reports a clipboard failure; the full link stays visible to copy manually", async () => {
    writeText.mockRejectedValue(new Error("NotAllowedError"));
    const copy = await replaceAndOpenPanel();
    fireEvent.click(copy);
    expect(await within(toastAlert()).findByText(COPY_FAILURE)).toBeTruthy();
    expect(COPY_FAILURE).toBe("Requisition link could not be copied. Please try again.");
    expect((screen.getByLabelText("Requisition link") as HTMLInputElement).value).toBe(FULL);
  });

  it("once dismissed, the card shows only the truncated identifier again", async () => {
    await replaceAndOpenPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it("handles browsers without a clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const copy = await replaceAndOpenPanel();
    fireEvent.click(copy);
    expect(await within(toastAlert()).findByText(COPY_FAILURE)).toBeTruthy();
  });

  it("is a real, keyboard-focusable button", async () => {
    const copy = await replaceAndOpenPanel();
    expect(copy.tagName).toBe("BUTTON");
    copy.focus();
    expect(document.activeElement).toBe(copy);
  });

  it("is offered right after creating a new link too", async () => {
    createFormLink.mockResolvedValue({ ok: true, data: { url: FULL }, message: "Requisition link created successfully." });
    writeText.mockResolvedValue();
    renderLinks([]);
    fireEvent.click(screen.getByRole("button", { name: /New requisition link/ }));
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "Hospitality leads" } });
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));
    fireEvent.click(await screen.findByRole("button", { name: /Copy link/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));
  });
});
