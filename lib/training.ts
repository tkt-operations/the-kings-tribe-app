/**
 * Training environment support (docs/training/TRAINING-ENVIRONMENT.md).
 *
 * Training mode is on ONLY when NEXT_PUBLIC_APP_ENVIRONMENT is exactly
 * "training". When it is absent or anything else, nothing here changes how
 * the application looks or behaves.
 *
 * In training mode the application refuses to talk to the production
 * Supabase project, so a training deployment that was given production
 * settings by mistake cannot read or write production data.
 */

/** The production Supabase project reference. Not a secret: it is part of the public project URL. */
export const PRODUCTION_SUPABASE_PROJECT_REF = "xxemwgdmibhneefnfiyr";

export const TRAINING_REFUSAL_MESSAGE =
  "Training environment is configured with the production database. Application startup refused.";

export class TrainingConfigurationError extends Error {
  constructor() {
    super(TRAINING_REFUSAL_MESSAGE);
    this.name = "TrainingConfigurationError";
  }
}

export function isTrainingMode(): boolean {
  // Literal property access so Next.js inlines the value in browser bundles.
  return process.env.NEXT_PUBLIC_APP_ENVIRONMENT === "training";
}

/** True when the URL refers to the production project in any form (host, path or query). */
export function pointsAtProductionProject(supabaseUrl: string): boolean {
  return supabaseUrl.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF);
}

/** The refusal message when training mode is configured with the production project, otherwise null. */
export function trainingDatabaseRefusal(supabaseUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): string | null {
  if (!isTrainingMode()) return null;
  return pointsAtProductionProject(supabaseUrl) ? TRAINING_REFUSAL_MESSAGE : null;
}

/** Throws before any Supabase client is created for a training deployment pointed at production. */
export function assertTrainingDatabaseIsSafe(supabaseUrl?: string): void {
  if (trainingDatabaseRefusal(supabaseUrl) !== null) throw new TrainingConfigurationError();
}
