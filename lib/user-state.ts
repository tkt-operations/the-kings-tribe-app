/**
 * Account states on the Users page.
 *
 * Setup completion is the app's own record, profiles.account_setup_completed_at,
 * set only after the person chose a password here or signed in with one.
 * Supabase's email_confirmed_at / last_sign_in_at are NOT used for this: both
 * are set the moment an invitation link is opened, before any password is
 * chosen. Deactivation (profiles.is_active) is independent.
 *
 *   pending_setup        setup not completed, profile active
 *   active               setup completed, profile active
 *   deactivated_pending  setup not completed, profile deactivated
 *   deactivated_active   setup completed, profile deactivated
 *
 * Only pending_setup users may be sent a new setup link. Which kind depends on
 * Supabase: an invitation while their email is unconfirmed; once confirmed,
 * Supabase refuses re-invitations, so a password recovery link instead.
 * Active users use Forgot password; deactivated users must be reactivated first.
 */
export type UserState = "pending_setup" | "active" | "deactivated_pending" | "deactivated_active";
export type SetupChannel = "invite" | "recovery";

export function userState({ setupCompleted, isActive }: { setupCompleted: boolean; isActive: boolean }): UserState {
  if (setupCompleted) return isActive ? "active" : "deactivated_active";
  return isActive ? "pending_setup" : "deactivated_pending";
}

/** Supabase's own notion of confirmed (it refuses re-invitations once this is set). */
export function isEmailConfirmed(user: { email_confirmed_at?: string | null }): boolean {
  return Boolean(user.email_confirmed_at);
}

/** How to send a new setup link, or null when none may be sent. */
export function setupChannel(state: UserState, emailConfirmed: boolean): SetupChannel | null {
  if (state !== "pending_setup") return null;
  return emailConfirmed ? "recovery" : "invite";
}
