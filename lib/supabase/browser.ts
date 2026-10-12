"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { assertTrainingDatabaseIsSafe } from "@/lib/training";

/**
 * Browser client: publishable key only. Used for direct-to-Storage uploads,
 * realtime counts, and /auth/callback.
 *
 * detectSessionInUrl is OFF for every browser client (this factory is the only
 * one, and @supabase/ssr makes it a page-wide singleton). Otherwise the SDK
 * exchanges a ?code= on its own while initialising and the callback's explicit
 * exchange then fails on the already-used code. /auth/callback is the single
 * owner of auth-link processing.
 */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  assertTrainingDatabaseIsSafe(env.supabaseUrl);
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { detectSessionInUrl: false },
  });
}
