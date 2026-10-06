// @vitest-environment jsdom
import "./setup";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import type { AuthFormState } from "@/app/(auth)/login/actions";

const signIn = vi.fn<(prev: AuthFormState, fd: FormData) => Promise<AuthFormState>>();
vi.mock("@/app/(auth)/login/actions", () => ({ signIn: (p: AuthFormState, fd: FormData) => signIn(p, fd) }));

const { LoginForm } = await import("@/app/(auth)/login/login-form");

beforeEach(() => {
  signIn.mockReset();
});

describe("sign in", () => {
  it("requires email and password before contacting the server", async () => {
    render(<ToastProvider><LoginForm /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Email address is required.")).toBeTruthy();
    expect(screen.getByText("Password is required.")).toBeTruthy();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("shows the sign-in failure as a toast and keeps the email", async () => {
    const user = userEvent.setup();
    signIn.mockResolvedValue({ error: "Sign in failed. Please check your email and password." });
    render(<ToastProvider><LoginForm /></ToastProvider>);
    await user.type(screen.getByLabelText(/Email address/), "grace@church.org");
    await user.type(screen.getByLabelText(/^Password/), "wrong password");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const toast = await waitFor(() => screen.getAllByRole("alert").find((el) => el.getAttribute("aria-live") === "assertive")!);
    expect(await within(toast).findByText("Sign in failed. Please check your email and password.")).toBeTruthy();
    expect((screen.getByLabelText(/Email address/) as HTMLInputElement).value).toBe("grace@church.org");
  });
});
