/** Uniform result for server actions consumed by client forms. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** An error whose message is safe to show to the user. */
export class ActionError extends Error {
  constructor(message: string, readonly fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ActionError";
  }
}

interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

const CONSTRAINT_MESSAGES: Record<string, string> = {
  requisitions_requester_email_check: "Please enter a valid email address.",
  requisitions_requester_phone_check: "Please enter a valid phone number.",
  requisitions_justification_check: "Please describe how this request supports your ministry (at least 20 characters).",
  categories_unique_name: "A category with that name already exists.",
  departments_name_key: "A department with that name already exists.",
  department_subcategories_name_key: "That subcategory already exists in this department.",
  cost_centers_code_key: "A cost center with that code already exists.",
  profiles_email_key: "A user with that email already exists.",
};

/**
 * Convert a database error into a safe, friendly message.
 * Messages raised deliberately by our functions (errcode P0001) are written
 * for end users; anything else is replaced with a generic message.
 */
export function friendlyDbError(error: PostgrestLikeError | null | undefined): string {
  if (!error) return "Something went wrong. Please try again.";
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "42501") return "You do not have permission to do that.";
  if (error.code === "23505" || error.code === "23514" || error.code === "23503") {
    for (const [constraint, message] of Object.entries(CONSTRAINT_MESSAGES)) {
      if (error.message?.includes(constraint)) return message;
    }
    if (error.code === "23505") return "That record already exists.";
    if (error.code === "23503") return "This record is in use and cannot be changed that way.";
    return "Some of the values entered are not valid.";
  }
  return "Something went wrong. Please try again.";
}

export function toActionError(error: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (error instanceof ActionError) return { ok: false, error: error.message, fieldErrors: error.fieldErrors };
  console.error(error);
  return { ok: false, error: "Something went wrong. Please try again." };
}
