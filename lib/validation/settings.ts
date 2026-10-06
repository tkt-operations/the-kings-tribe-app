import { z } from "zod";

// Optional text: blank saves as NULL; NULL from the database reads as blank.
const optional = (max: number) => z.preprocess((v) => v ?? "", z.string().trim().max(max)).transform((v) => (v === "" ? null : v));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Accept DB nulls when checking a saved row (setup completion uses these same rules).
const text = (schema: z.ZodString) => z.preprocess((v) => v ?? "", schema);

/**
 * Church settings are edited in sections. Each section validates (and saves)
 * only its own columns, and the setup wizard decides whether a step is
 * complete by running the SAME rules against the row saved in the database.
 */
const church = {
  church_name: text(z.string().trim().min(2, "Church name is required.").max(120)),
  // Address, phone and email are printed on Purchase Orders and emails.
  address_line1: text(z.string().trim().min(2, "Address line 1 is required.").max(200)),
  address_line2: optional(200),
  city: optional(100),
  region: optional(100),
  postal_code: optional(20),
  country: optional(100),
  phone: text(
    z.string().trim().min(1, "Phone is required.").max(40)
      .refine((v) => (v.match(/\d/g) ?? []).length >= 7, "Enter a valid phone number."),
  ),
  email: text(z.string().trim().min(1, "Church email is required.").max(254).refine((v) => EMAIL.test(v), "Enter a valid email address.")),
  website: z.preprocess(
    (v) => v ?? "",
    z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\//i.test(v), "Enter a website address starting with https://"),
  ).transform((v) => (v === "" ? null : v)),
};

const money = {
  currency_code: text(z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD.")),
  timezone: text(z.string()).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz !== "";
    } catch {
      return false;
    }
  }, "Choose a valid timezone."),
};

const emailList = (v: string) => v.split(/[,;\s]+/).filter(Boolean).every((e) => EMAIL.test(e));

const notifications = {
  finance_notification_email: z
    .preprocess((v) => v ?? "", z.string().trim().max(500))
    .refine((v) => v === "" || emailList(v), "Enter one or more valid email addresses separated by commas.")
    .transform((v) => (v === "" ? null : v)),
};

const policy = {
  requisition_policy: text(z.string().trim().min(10, "Policy text is required (at least 10 characters).").max(4000)),
  po_instructions: text(z.string().trim().min(10, "Instructions are required (at least 10 characters).").max(2000)),
  po_footer: text(z.string().trim().min(10, "Footer text is required (at least 10 characters).").max(1000)),
};

export const SETTINGS_SECTIONS = { church, money, notifications, policy } as const;
export type SettingsSection = keyof typeof SETTINGS_SECTIONS;
export const ALL_SETTINGS_SECTIONS: SettingsSection[] = ["church", "money", "notifications", "policy"];

/** Every editable settings column. */
export const settingsSchema = z.object({ ...church, ...money, ...notifications, ...policy });

/**
 * Schema for just the given sections. `requireNotificationEmail` is used by
 * the setup wizard, where naming a Finance notification address is part of
 * completing step 2 (elsewhere it may be left blank to notify reviewers).
 */
export function sectionSchema(sections: readonly SettingsSection[], options: { requireNotificationEmail?: boolean } = {}) {
  const shape = Object.assign({}, ...sections.map((s) => SETTINGS_SECTIONS[s])) as Record<string, z.ZodType>;
  if (options.requireNotificationEmail && sections.includes("notifications")) {
    shape.finance_notification_email = z
      .preprocess((v) => v ?? "", z.string().trim().max(500))
      .refine((v) => v !== "", "Finance notification email is required.")
      .refine((v) => v === "" || emailList(v), "Enter one or more valid email addresses separated by commas.");
  }
  return z.object(shape);
}

/** Columns belonging to the given sections. */
export function sectionColumns(sections: readonly SettingsSection[]): string[] {
  return sections.flatMap((s) => Object.keys(SETTINGS_SECTIONS[s]));
}
