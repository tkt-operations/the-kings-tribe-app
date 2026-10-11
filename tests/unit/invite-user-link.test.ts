/**
 * "Invite user → Give me a link": the manager gets our protected callback link
 * (token hash in the fragment), never Supabase's raw /verify action_link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ assertPermission: vi.fn(async () => ({ id: "99999999-9999-4999-8999-999999999999" })) }));

const NEW_USER = "44444444-4444-4444-8444-444444444444";
const ROLE = "55555555-5555-4555-8555-555555555555";
const HASH = "e5".repeat(28);
const TOKEN = "t".repeat(56);
const RAW = `https://project.supabase.co/auth/v1/verify?token=${TOKEN}&type=invite&redirect_to=x`;
type Gen = { data: { user: { id: string } | null; properties: Record<string, string> | null }; error: unknown };
const generateLink = vi.fn<(p: unknown) => Promise<Gen>>(async () => ({ data: { user: { id: NEW_USER }, properties: { action_link: RAW, hashed_token: HASH, verification_type: "invite" } }, error: null }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ auth: { admin: { generateLink, inviteUserByEmail: vi.fn() } } }) }));
const writes: { table: string; op: string }[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.update = () => { writes.push({ table, op: "update" }); return c; };
      c.insert = async () => { writes.push({ table, op: "insert" }); return { error: null }; };
      c.eq = async () => ({ error: null });
      return c;
    },
  }),
}));

const { inviteUser } = await import("@/app/(app)/admin/users/actions");
const input = { email: "new.person@demo.invalid", full_name: "New Person", role_ids: [ROLE], delivery: "link" as const };
const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

beforeEach(() => {
  generateLink.mockClear();
  consoleError.mockClear();
  writes.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://ops.thekingstribe.org";
});

describe("inviteUser (link delivery)", () => {
  it("returns the protected app link, never the raw action_link", async () => {
    const r = await inviteUser(input);
    expect(r.ok).toBe(true);
    const link = r.ok ? r.data.link! : "";
    expect(link).toBe(`https://ops.thekingstribe.org/auth/callback?next=/auth/update-password#token_hash=${HASH}&type=invite`);
    expect(link).not.toContain("supabase.co");
    expect(link).not.toContain(TOKEN);
    expect(writes).toEqual([{ table: "profiles", op: "update" }, { table: "user_roles", op: "insert" }]);
  });

  it("if Supabase returns no usable hash, the account and roles are kept and the manager is told to replace the link", async () => {
    generateLink.mockResolvedValueOnce({ data: { user: { id: NEW_USER }, properties: { action_link: RAW } }, error: null });
    const r = await inviteUser(input);
    expect(r).toEqual({ ok: false, error: "The team member was added, but the invitation link could not be created. Use Replace invitation link on their card." });
    expect(writes.map((w) => w.table)).toEqual(["profiles", "user_roles"]);
    expect(JSON.stringify(r)).not.toContain("supabase.co");
  });

  it("nothing secret is logged", async () => {
    await inviteUser(input);
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(HASH);
    expect(logged).not.toContain(TOKEN);
  });
});
