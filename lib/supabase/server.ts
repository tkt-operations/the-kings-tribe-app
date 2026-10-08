import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { assertTrainingDatabaseIsSafe } from "@/lib/training";

/**
 * Request-scoped client acting AS THE SIGNED-IN USER. Row Level Security and
 * the permission checks inside database functions apply to every call.
 */
export async function createSupabaseServerClient() {
  const env = publicEnv();
  assertTrainingDatabaseIsSafe(env.supabaseUrl);
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are refreshed by proxy.ts instead.
        }
      },
    },
  });
}

/** Anonymous client (no session) for the public requisition form. */
export function createSupabaseAnonClient() {
  const env = publicEnv();
  assertTrainingDatabaseIsSafe(env.supabaseUrl);
  return createServerClient(env.supabaseUrl, env.supabasePublishableKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
