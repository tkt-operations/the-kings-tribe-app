import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { requirePagePermission } from "@/lib/auth";
import { createSupabaseAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasActivatedAccount } from "@/lib/user-state";
import { UserAdmin } from "./user-admin";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePagePermission("users.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: profiles }, { data: roles }, { data: userRoles }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, is_active").order("full_name"),
    supabase.from("roles").select("id, key, name, description").order("is_system", { ascending: false }).order("name"),
    supabase.from("user_roles").select("user_id, role_id"),
  ]);
  // Auth metadata (invitation accepted? last sign-in) comes from the server-only admin API.
  const authInfo = new Map<string, { confirmed: boolean; lastSignIn: string | null }>();
  if (isAdminClientConfigured()) {
    const { data } = await createSupabaseAdminClient().auth.admin.listUsers({ perPage: 200 });
    for (const u of data?.users ?? []) authInfo.set(u.id, { confirmed: hasActivatedAccount(u), lastSignIn: u.last_sign_in_at ?? null });
  }
  const users = ((profiles ?? []) as { id: string; email: string; full_name: string; is_active: boolean }[]).map((p) => ({
    ...p,
    roleIds: ((userRoles ?? []) as { user_id: string; role_id: string }[]).filter((r) => r.user_id === p.id).map((r) => r.role_id),
    confirmed: authInfo.get(p.id)?.confirmed ?? true,
    lastSignIn: authInfo.get(p.id)?.lastSignIn ?? null,
  }));
  return (
    <>
      <PageHeader eyebrow="Administration" title="Users" description="Internal staff accounts. Each person can hold one or more roles; permissions are set per role." />
      {!isAdminClientConfigured() ? <Alert tone="warning" className="mb-4" title="Invitations need SUPABASE_SECRET_KEY">Add the server key to enable invitations.</Alert> : null}
      <UserAdmin users={users} roles={(roles ?? []) as never} currentUserId={me.id} />
    </>
  );
}
