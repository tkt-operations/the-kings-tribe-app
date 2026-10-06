/**
 * Small, framework-free validation helpers for client forms.
 *
 * The server stays the authority (zod schemas + database constraints); these
 * rules mirror them so people see the problem next to the field before a
 * round trip. Every check returns a user-facing message or null.
 */
import { parseMoney, parseQuantity } from "@/lib/money";

export type FieldErrors = Record<string, string>;
export type Check = (value: string) => string | null;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const blank = (v: string | null | undefined) => (v ?? "").trim() === "";

export const rules = {
  required:
    (message: string): Check =>
    (v) =>
      blank(v) ? message : null,

  minLength:
    (min: number, message: string): Check =>
    (v) =>
      !blank(v) && v.trim().length < min ? message : null,

  maxLength:
    (max: number, message: string): Check =>
    (v) =>
      v.trim().length > max ? message : null,

  email:
    (message = "Enter a valid email address."): Check =>
    (v) =>
      !blank(v) && !EMAIL.test(v.trim()) ? message : null,

  /** Comma-separated list of addresses (blank allowed). */
  emailList:
    (message = "Enter valid email addresses separated by commas."): Check =>
    (v) =>
      !blank(v) && v.split(",").some((part) => !EMAIL.test(part.trim())) ? message : null,

  url:
    (message = "Enter a web address starting with https://"): Check =>
    (v) =>
      !blank(v) && !/^https?:\/\/\S+$/i.test(v.trim()) ? message : null,

  /** Any well-formed amount (0 allowed). Blank passes — pair with `required`. */
  money:
    (message = "Enter an amount like 24.99."): Check =>
    (v) =>
      !blank(v) && parseMoney(v) === null ? message : null,

  /** Amount strictly greater than zero. */
  positiveMoney:
    (message = "Enter an amount greater than $0."): Check =>
    (v) => {
      if (blank(v)) return null;
      const cents = parseMoney(v);
      return cents === null || cents <= 0n ? message : null;
    },

  quantity:
    (message = "Enter a quantity greater than 0."): Check =>
    (v) =>
      !blank(v) && parseQuantity(v) === null ? message : null,

  /** Quantity no larger than `max` hundredths (e.g. remaining approved quantity). */
  maxQuantity:
    (maxHundredths: bigint, message: string): Check =>
    (v) => {
      const q = parseQuantity(v);
      return q !== null && q > maxHundredths ? message : null;
    },

  date:
    (message = "Choose a valid date."): Check =>
    (v) =>
      !blank(v) && !ISO_DATE.test(v.trim()) ? message : null,

  notAfter:
    (maxIso: string, message: string): Check =>
    (v) =>
      !blank(v) && v > maxIso ? message : null,

  notBefore:
    (minIso: string, message: string): Check =>
    (v) =>
      !blank(v) && minIso !== "" && v < minIso ? message : null,

  matches:
    (other: string, message: string): Check =>
    (v) =>
      v !== other ? message : null,
};

/**
 * Run checks per field; the first failing check wins for each field.
 * Keys are the field ids used in the form so errors can be focused.
 *
 *   validate({ email: [values.email, rules.required("Email address is required."), rules.email()] })
 */
export function validate(spec: Record<string, [string | null | undefined, ...Check[]]>): FieldErrors {
  const errors: FieldErrors = {};
  for (const [field, [value, ...checks]] of Object.entries(spec)) {
    for (const check of checks) {
      const message = check(value ?? "");
      if (message) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
