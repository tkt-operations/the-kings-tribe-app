import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/server-env";

/**
 * Service-role client. BYPASSES Row Level Security.
 *
 * Only used for narrowly scoped trusted operations:
 *   - submitting external requisitions (after validation + rate limiting)
 *   - signed upload URLs for external receipt uploads
 *   - inbound-email ingestion
 *   - sending notifications (reading recipients)
 *   - inviting users / bootstrapping the first administrator
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const { supabaseUrl } = publicEnv();
  const { supabaseSecretKey } = serverEnv();
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error("Supabase server credentials are not configured (SUPABASE_SECRET_KEY).");
  }
  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isAdminClientConfigured(): boolean {
  return Boolean(publicEnv().supabaseUrl && serverEnv().supabaseSecretKey);
}
