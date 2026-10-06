import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAny, isPermission, type Permission } from "@/lib/permissions";
import { ActionError } from "@/lib/action-result";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: ReadonlySet<Permission>;
}

/**
 * The signed-in, ACTIVE internal user — verified with Supabase Auth on every
 * request (getUser contacts the Auth server; it is not just cookie decoding).
 * Cached for the duration of one request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const [{ data: profile }, { data: perms }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, is_active").eq("id", auth.user.id).maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("user_roles").select("roles(key)").eq("user_id", auth.user.id),
  ]);
  if (!profile || !profile.is_active) return null;

  const permissions = new Set<Permission>(((perms as string[] | null) ?? []).filter(isPermission));
  const roles = ((roleRows ?? []) as unknown as { roles: { key: string } | null }[])
    .map((r) => r.roles?.key)
    .filter((k): k is string => Boolean(k));

  return {
    id: profile.id as string,
    email: profile.email as string,
    fullName: (profile.full_name as string) || (profile.email as string),
    roles,
    permissions,
  };
});

/** For pages and layouts: redirect to /login when there is no active session. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: require at least one of the permissions or show the access-denied page. */
export async function requirePagePermission(required: Permission | readonly Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasAny(user.permissions, required)) redirect("/forbidden");
  return user;
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertPermission(required: Permission | readonly Permission[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new ActionError("Your session has expired. Please sign in again.");
  if (!hasAny(user.permissions, required)) throw new ActionError("You do not have permission to do that.");
  return user;
}
