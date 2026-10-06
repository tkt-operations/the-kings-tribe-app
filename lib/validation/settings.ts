import { z } from "zod";

const optional = (max: number) => z.string().trim().max(max).transform((v) => (v === "" ? null : v));

export const settingsSchema = z.object({
  church_name: z.string().trim().min(2, "Church name is required.").max(120),
  address_line1: optional(200),
  address_line2: optional(200),
  city: optional(100),
  region: optional(100),
  postal_code: optional(20),
  country: optional(100),
  phone: optional(40),
  email: z.string().trim().max(254).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address.").transform((v) => (v === "" ? null : v)),
  website: z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\//i.test(v), "Enter a website address starting with https://").transform((v) => (v === "" ? null : v)),
  currency_code: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code such as USD."),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone."),
  finance_notification_email: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || v.split(/[,;\s]+/).filter(Boolean).every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), "Enter one or more valid email addresses separated by commas.")
    .transform((v) => (v === "" ? null : v)),
  requisition_policy: z.string().trim().min(10, "Policy text is required (at least 10 characters).").max(4000),
  po_instructions: z.string().trim().min(10, "Instructions are required (at least 10 characters).").max(2000),
  po_footer: z.string().trim().min(10, "Footer text is required (at least 10 characters).").max(1000),
});

