/**
 * Environment access.
 *
 * Only variables prefixed NEXT_PUBLIC_ are ever sent to the browser.
 * Server-only secrets are read through `serverEnv()` which imports
 * "server-only", so any accidental import from client code fails the build.
 */
export function publicEnv() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabasePublishableKey:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    // Web Push application-server PUBLIC key (safe to expose). Empty = push off.
    vapidPublicKey: (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim(),
  };
}

export function isSupabaseConfigured(): boolean {
  const env = publicEnv();
  return Boolean(env.supabaseUrl && env.supabasePublishableKey);
}
