"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** Browser client: publishable key only. Used for direct-to-Storage uploads. */
export function createSupabaseBrowserClient() {
  const env = publicEnv();
  return createBrowserClient(env.supabaseUrl, env.supabasePublishableKey);
}
