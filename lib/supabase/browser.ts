"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { assertTrainingDatabaseIsSafe } from "@/lib/training";

/** Browser client: publishable key only. Used for direct-to-Storage uploads. */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  assertTrainingDatabaseIsSafe(env.supabaseUrl);
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
