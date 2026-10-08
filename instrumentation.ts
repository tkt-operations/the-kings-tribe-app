import { assertTrainingDatabaseIsSafe } from "@/lib/training";

/**
 * Runs once when a server instance starts. A training deployment configured
 * with the production Supabase project refuses to start (lib/training.ts).
 * Outside training mode this does nothing.
 */
export function register() {
  assertTrainingDatabaseIsSafe();
}
