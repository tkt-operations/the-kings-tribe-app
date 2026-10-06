// @vitest-environment jsdom
import "./setup";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { SetupState } from "@/app/setup/actions";

const createFirstAdministrator = vi.fn<(prev: SetupState, fd: FormData) => Promise<SetupState>>();
vi.mock("@/app/setup/actions", () => ({ createFirstAdministrator: (prev: SetupState, fd: FormData) => createFirstAdministrator(prev, fd) }));

const { SetupForm } = await import("@/app/setup/setup-form");

const renderForm = () => render(<ToastProvider><SetupForm /></ToastProvider>);
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Create administrator" }));

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Setup token/), "a-very-long-setup-token-123456");
  await user.type(screen.getByLabelText(/Your full name/), "Grace Hopper");
  await user.type(screen.getByLabelText(/Your email address/), "grace@church.org");
  await user.type(screen.getByLabelText(/^Password/), "correct horse battery");
  await user.type(screen.getByLabelText(/Confirm password/), "correct horse battery");
}

beforeEach(() => {
  createFirstAdministrator.mockReset();
});

describe("/setup Administrator form", () => {
  it("marks every field required with correct semantics", () => {
    renderForm();
    expect(screen.getByText("Required fields")).toBeTruthy();
    for (const label of [/Setup token/, /Your full name/, /Your email address/, /^Password/, /Confirm password/]) {
      expect(screen.getByLabelText(label).getAttribute("aria-required")).toBe("true");
    }
  });

  it("blocks an empty submission with inline errors and focuses the first invalid field", async () => {
    renderForm();
    submit();
    expect(await screen.findByText("Setup token is required.")).toBeTruthy();
    expect(screen.getByText("Full name is required.")).toBeTruthy();
    expect(screen.getByText("Email address is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(screen.getByLabelText(/Setup token/).getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText(/Setup token/).getAttribute("aria-describedby")).toBe("setup_token-error");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Setup token/)));
    expect(within(screen.getByRole("alert", { name: "" })).getByText(/review the highlighted fields/i)).toBeTruthy();
    expect(createFirstAdministrator).not.toHaveBeenCalled();
  });

  it("explains invalid input inline", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/Your email address/), "grace@");
    await user.type(screen.getByLabelText(/^Password/), "short");
    await user.type(screen.getByLabelText(/Confirm password/), "different");
    submit();
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Use at least 12 characters.")).toBeTruthy();
    expect(screen.getByText("Passwords do not match.")).toBeTruthy();
  });

  it("shows an error toast and form-level message on failure, keeping everything typed", async () => {
    const user = userEvent.setup();
    createFirstAdministrator.mockResolvedValue({ error: "The setup token is not correct.", fieldErrors: { setup_token: "The setup token is not correct." } });
    renderForm();
    await fillValid(user);
    submit();
    const toastRegion = screen.getAllByRole("alert").find((el) => el.getAttribute("aria-live") === "assertive")!;
    expect(await within(toastRegion).findByText("The setup token is not correct.")).toBeTruthy();
    expect(screen.getByText("The administrator was not created")).toBeTruthy();
    expect((screen.getByLabelText(/Setup token/) as HTMLInputElement).value).toBe("a-very-long-setup-token-123456");
    expect((screen.getByLabelText(/Your full name/) as HTMLInputElement).value).toBe("Grace Hopper");
    expect((screen.getByLabelText(/Your email address/) as HTMLInputElement).value).toBe("grace@church.org");
    expect((screen.getByLabelText(/^Password/) as HTMLInputElement).value).toBe("correct horse battery");
    expect(screen.getByLabelText(/Setup token/).getAttribute("aria-invalid")).toBe("true");
  });

  it("prevents duplicate submissions while creating the account", async () => {
    const user = userEvent.setup();
    let resolve!: (s: SetupState) => void;
    createFirstAdministrator.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderForm();
    await fillValid(user);
    const button = screen.getByRole("button", { name: "Create administrator" });
    const form = button.closest("form")!;
    fireEvent.click(button);
    fireEvent.click(button); // double click
    fireEvent.submit(form); // Enter key while the first request is running
    expect(createFirstAdministrator).toHaveBeenCalledTimes(1);
    const busy = await screen.findByRole("button", { name: "Creating administrator…" });
    expect(busy).toHaveProperty("disabled", true);
    await act(async () => resolve({ error: "Unable to create the administrator account. Please try again." }));
    expect(await screen.findByRole("button", { name: "Create administrator" })).toHaveProperty("disabled", false);
  });

  it("sends the typed values to the server action", async () => {
    const user = userEvent.setup();
    createFirstAdministrator.mockResolvedValue(undefined);
    renderForm();
    await fillValid(user);
    submit();
    await waitFor(() => expect(createFirstAdministrator).toHaveBeenCalledTimes(1));
    const fd = createFirstAdministrator.mock.calls[0][1];
    expect(fd.get("email")).toBe("grace@church.org");
    expect(fd.get("full_name")).toBe("Grace Hopper");
  });
});
