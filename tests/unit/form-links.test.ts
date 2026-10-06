/** Requisition links: canonical URL, hash-only storage, replace flow, authorization. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const assertPermission = vi.fn();
vi.mock("@/lib/auth", () => ({ assertPermission: (...a: unknown[]) => assertPermission(...a) }));

const inserts: Record<string, unknown>[] = [];
const updates: { values: Record<string, unknown>; id?: unknown }[] = [];
let existing: Record<string, unknown> | null = null;
let insertError: unknown = null;
let updateError: unknown = null;
function table() {
  let pendingUpdate: Record<string, unknown> | null = null;
  const b = {
    insert: async (row: Record<string, unknown>) => { if (insertError) return { error: insertError }; inserts.push(row); return { error: null }; },
    select: () => b,
    update: (v: Record<string, unknown>) => { pendingUpdate = v; return b; },
    eq: (_c: string, v: unknown) => {
      if (pendingUpdate) { if (!updateError) updates.push({ values: pendingUpdate, id: v }); pendingUpdate = null; return Promise.resolve({ error: updateError }); }
      return b;
    },
    maybeSingle: async () => ({ data: existing, error: null }),
  };
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ from: () => table() }) }));

const { createFormLink, replaceFormLink } = await import("@/app/(app)/admin/form-links/actions");
const { displayRequisitionLink, requisitionLinkUrl } = await import("@/lib/links");

const ID = "00000000-0000-4000-8000-0000000000aa";
const USER = { id: "00000000-0000-4000-8000-0000000000ad" };

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ops.thekingstribe.org");
  assertPermission.mockResolvedValue(USER);
  inserts.length = 0;
  updates.length = 0;
  insertError = null;
  updateError = null;
  existing = { id: ID, label: "Production Team", department_id: "00000000-0000-4000-8000-0000000000dd", expires_at: null, max_submissions: 20, is_active: true, revoked_at: null };
});
afterEach(() => vi.unstubAllEnvs());

describe("canonical requisition URL", () => {
  it("is built from NEXT_PUBLIC_APP_URL, not a hard-coded domain", () => {
    expect(requisitionLinkUrl("Tok_123")).toBe("https://ops.thekingstribe.org/request/Tok_123");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.org/");
    expect(requisitionLinkUrl("Tok_123")).toBe("https://staging.example.org/request/Tok_123");
  });

  it("displays only the 6-character hint", () => {
    expect(displayRequisitionLink("Ab3dE9")).toBe("ops.thekingstribe.org/request/Ab3dE9…");
  });
});

describe("createFormLink", () => {
  it("returns the complete canonical URL once and stores only a hash and hint", async () => {
    const r = await createFormLink({ label: "Production Team", department_id: null, expires_in_days: 0, max_submissions: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const token = r.data.url.split("/request/")[1];
    expect(r.data.url).toMatch(/^https:\/\/ops\.thekingstribe\.org\/request\/[A-Za-z0-9_-]{43}$/);
    expect(inserts[0]).toMatchObject({ token_hint: token.slice(0, 6) });
    expect(inserts[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserts[0])).not.toContain(token);
  });
});

describe("replaceFormLink", () => {
  it("creates an identical new link, revokes the old one, and returns the new URL", async () => {
    const r = await replaceFormLink(ID);
    expect(r).toMatchObject({ ok: true, data: { oldRevoked: true }, message: "Requisition link replaced. The old link no longer works." });
    expect(inserts[0]).toMatchObject({ label: "Production Team", department_id: existing!.department_id, max_submissions: 20, expires_at: null, created_by: USER.id });
    expect(updates[0]).toMatchObject({ id: ID, values: { is_active: false, revoked_by: USER.id } });
    if (r.ok) expect(r.data.url.startsWith("https://ops.thekingstribe.org/request/")).toBe(true);
  });

  it("refuses revoked or expired links", async () => {
    existing = { ...existing!, revoked_at: "2026-10-01T00:00:00Z", is_active: false };
    expect(await replaceFormLink(ID)).toMatchObject({ ok: false, error: "Only active links can be replaced. Create a new link instead." });
    existing = { ...existing!, revoked_at: null, is_active: true, expires_at: "2020-01-01T00:00:00Z" };
    expect(await replaceFormLink(ID)).toMatchObject({ ok: false, error: "This link has expired. Create a new link instead." });
    expect(inserts).toHaveLength(0);
  });

  it("requires the form_links.manage permission", async () => {
    const { ActionError } = await import("@/lib/action-result");
    assertPermission.mockRejectedValue(new ActionError("You do not have permission to do that."));
    expect(await replaceFormLink(ID)).toEqual({ ok: false, error: "You do not have permission to do that." });
    expect(await createFormLink({ label: "X link", department_id: null, expires_in_days: 0, max_submissions: 0 })).toEqual({ ok: false, error: "You do not have permission to do that." });
    expect(assertPermission).toHaveBeenCalledWith("form_links.manage");
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("replacement failure safety", () => {
  it("if the new link can't be created, the old link is left active (never revoked)", async () => {
    insertError = { code: "XX000", message: "boom" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await replaceFormLink(ID);
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it("if revoking fails after creating, the admin still gets the new link and a clear warning", async () => {
    updateError = { code: "XX000", message: "boom" };
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(JSON.stringify(a)); });
    const r = await replaceFormLink(ID);
    expect(r).toMatchObject({ ok: true, data: { oldRevoked: false }, message: "New link created, but the old link is still active. Revoke it manually." });
    // Diagnostics never contain the raw token or the URL.
    if (r.ok) {
      const token = r.data.url.split("/request/")[1];
      expect(logged.join(" ")).not.toContain(token);
      expect(logged.join(" ")).not.toContain("/request/");
    }
    vi.restoreAllMocks();
  });

  it("never writes the raw token anywhere it persists", async () => {
    const all: unknown[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { all.push(a); });
    const r = await replaceFormLink(ID);
    if (!r.ok) throw new Error("expected success");
    const token = r.data.url.split("/request/")[1];
    expect(JSON.stringify(inserts)).not.toContain(token);
    expect(JSON.stringify(updates)).not.toContain(token);
    expect(JSON.stringify(all)).not.toContain(token);
    vi.restoreAllMocks();
  });
});
