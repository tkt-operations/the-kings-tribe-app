/**
 * Account states on the Users page, derived from real fields only:
 *  - Supabase Auth: email_confirmed_at / last_sign_in_at (set once the person
 *    accepts their invitation and signs in)
 *  - public.profiles.is_active (app-level deactivation; not an auth ban)
 *
 *   pending              invited, never activated, profile active
 *   active               activated, profile active
 *   deactivated          activated, profile deactivated
 *   pending_deactivated  never activated, profile deactivated
 *
 * Only `pending` may be sent a new invitation. Active users recover access with
 * a password reset; deactivated users (of either kind) must be reactivated
 * first, so a new invitation can never bypass a deactivation.
 */
export type UserState = "pending" | "active" | "deactivated" | "pending_deactivated";

export interface AuthActivationFields {
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}

/** True once the person has accepted an invitation (or otherwise signed in). */
export function hasActivatedAccount(user: AuthActivationFields): boolean {
  return Boolean(user.email_confirmed_at || user.last_sign_in_at);
}

export function userState({ activated, isActive }: { activated: boolean; isActive: boolean }): UserState {
  if (activated) return isActive ? "active" : "deactivated";
  return isActive ? "pending" : "pending_deactivated";
}

export function canReissueInvitation(state: UserState): boolean {
  return state === "pending";
}
