/**
 * /setup server action: field-level feedback, safe error messages, server-side
 * diagnostics, and the success flash that becomes a toast after the redirect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const TOKEN = "a-very-long-setup-token-123456";
const cookieSet = vi.fn();
const redirect = vi.fn((path: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${path};307;` });
});
const admin = {
  rpc: vi.fn(),
  auth: { admin: { createUser: vi.fn(), deleteUser: vi.fn() } },
};
const signInWithPassword = vi.fn();

vi.mock("next/navigation", () => ({ redirect: (p: string) => redirect(p) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/server-env", () => ({ serverEnv: () => ({ setupToken: TOKEN }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => admin }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { signInWithPassword } }) }));

const { createFirstAdministrator } = await import("@/app/setup/actions");

function form(values: Partial<Record<string, string>> = {}) {
  const fd = new FormData();
  const all = { setup_token: TOKEN, full_name: "Grace Hopper", email: "grace@church.org", password: "correct horse battery", confirm: "correct horse battery", ...values };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) fd.set(k, v);
  return fd;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  admin.rpc.mockImplementation(async (fn: string) => (fn === "administrator_exists" ? { data: false, error: null } : { data: null, error: null }));
  admin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null });
});
afterEach(() => {
  consoleError.mockRestore();
  vi.clearAllMocks();
});

describe("createFirstAdministrator", () => {
  it("returns per-field errors for missing and invalid input", async () => {
    const state = await createFirstAdministrator(undefined, form({ full_name: "", email: "nope", password: "short", confirm: "different" }));
    expect(state?.error).toMatch(/review the form/i);
    expect(state?.fieldErrors).toMatchObject({
      full_name: "Enter your full name.",
      email: "Enter a valid email address.",
      password: "Use at least 12 characters.",
    });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("flags a wrong setup token on the token field without creating anything", async () => {
    const state = await createFirstAdministrator(undefined, form({ setup_token: "wrong-token-wrong-token-xx" }));
    expect(state).toEqual({ error: "The setup token is not correct.", fieldErrors: { setup_token: "The setup token is not correct." } });
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it("never exposes auth internals, but logs diagnostics on the server", async () => {
    admin.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: "duplicate key value violates constraint users_pkey; service_role=eyJsecret", code: "unexpected_failure", status: 500 } });
    const state = await createFirstAdministrator(undefined, form());
    expect(state?.error).toBe("Unable to create the administrator account. Please try again.");
    expect(JSON.stringify(state)).not.toMatch(/eyJ|constraint|service_role/);
    expect(consoleError).toHaveBeenCalled();
  });

  it("puts a duplicate email on the email field", async () => {
    admin.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: "A user with this email address has already been registered", status: 422 } });
    const state = await createFirstAdministrator(undefined, form());
    expect(state?.fieldErrors?.email).toBe("A user with that email already exists.");
  });

  it("rolls back and returns a safe message when bootstrapping fails", async () => {
    admin.rpc.mockImplementation(async (fn: string) =>
      fn === "administrator_exists" ? { data: false, error: null } : { data: null, error: { code: "XX000", message: "internal: relation profiles" } },
    );
    const state = await createFirstAdministrator(undefined, form());
    expect(state?.error).toBe("Unable to finish setup. Please try again.");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalled();
  });

  it("on success queues the 'Administrator account created successfully.' toast and redirects", async () => {
    await expect(createFirstAdministrator(undefined, form())).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(cookieSet).toHaveBeenCalledWith("tkt_flash", "admin-created", expect.objectContaining({ path: "/", httpOnly: false, maxAge: 60 }));
    expect(redirect).toHaveBeenCalledWith("/admin/setup");
  });
});
