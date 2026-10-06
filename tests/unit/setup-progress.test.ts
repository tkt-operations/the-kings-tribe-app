import { describe, expect, it } from "vitest";
import { computeSetupProgress, describeIncomplete, isUsableLink, type SetupSnapshot } from "@/lib/setup/progress";

// Shape of the church_settings row as returned by the database (nulls included).
const freshRow = {
  church_name: "The Kings Tribe", address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null,
  phone: null, email: null, website: null, currency_code: "USD", timezone: "America/New_York", finance_notification_email: null,
  requisition_policy: "Submit purchase requests 3–7 days before funds/items are needed whenever practical.",
  po_instructions: "Present this Purchase Order to the vendor and keep the receipt.",
  po_footer: "This Purchase Order authorizes only the items listed.", setup_completed_at: null,
};
const savedChurch = { ...freshRow, address_line1: "100 Example Avenue", phone: "(555) 010-0000", email: "office@example.org" };
const snapshot = (over: Partial<SetupSnapshot> = {}): SetupSnapshot => ({
  settings: freshRow,
  activeCategories: { attendance: 2, finance: 3, requisition: 4 },
  departmentsReady: 3,
  activeUsers: 1,
  usableLinks: 0,
  ...over,
});
const step = (s: SetupSnapshot, n: number) => computeSetupProgress(s).steps.find((x) => x.n === n)!;

describe("Step 1 — Church information", () => {
  it("is not complete on a fresh installation (defaults are not a save)", () => {
    const s = step(snapshot(), 1);
    expect(s.done).toBe(false);
    expect(s.missing).toEqual(expect.arrayContaining(["Address line 1 is required.", "Phone is required.", "Church email is required."]));
  });

  it("is complete once the required church information is saved", () => {
    expect(step(snapshot({ settings: savedChurch }), 1)).toMatchObject({ done: true, missing: [] });
  });

  it("is incomplete if a saved value is invalid", () => {
    expect(step(snapshot({ settings: { ...savedChurch, email: "not-an-email" } }), 1).missing).toEqual(["Enter a valid email address."]);
    expect(step(snapshot({ settings: { ...savedChurch, phone: "12" } }), 1).done).toBe(false);
  });

  it("is incomplete when settings could not be read", () => {
    expect(step(snapshot({ settings: null }), 1)).toMatchObject({ done: false, missing: ["Settings could not be loaded."] });
  });
});

describe("Step 2 — Notification email & policies", () => {
  it("needs a saved Finance notification address", () => {
    expect(step(snapshot(), 2)).toMatchObject({ done: false, missing: ["Finance notification email is required."] });
    expect(step(snapshot({ settings: { ...freshRow, finance_notification_email: "finance@example.org, pastor@example.org" } }), 2).done).toBe(true);
    expect(step(snapshot({ settings: { ...freshRow, finance_notification_email: "finance@" } }), 2).done).toBe(false);
  });

  it("needs valid policy texts", () => {
    expect(step(snapshot({ settings: { ...freshRow, finance_notification_email: "f@example.org", po_footer: "short" } }), 2).done).toBe(false);
  });
});

describe("Steps 3 and 4 keep working", () => {
  it("categories: attendance, finance and expense categories exist", () => {
    expect(step(snapshot(), 3).done).toBe(true);
    expect(step(snapshot({ activeCategories: { attendance: 1, finance: 0, requisition: 1 } }), 3)).toMatchObject({ done: false, missing: ["Add at least one active finance category."] });
  });

  it("departments: an active department with an active subcategory", () => {
    expect(step(snapshot(), 4).done).toBe(true);
    expect(step(snapshot({ departmentsReady: 0 }), 4).done).toBe(false);
  });
});

describe("Steps 5 and 6", () => {
  it("team: someone besides the first administrator has an account (optional step)", () => {
    expect(step(snapshot(), 5)).toMatchObject({ done: false, required: false });
    expect(step(snapshot({ activeUsers: 2 }), 5).done).toBe(true);
  });

  it("links: at least one usable requisition link", () => {
    expect(step(snapshot(), 6).done).toBe(false);
    expect(step(snapshot({ usableLinks: 1 }), 6).done).toBe(true);
    const now = new Date("2026-10-06T12:00:00Z");
    const base = { is_active: true, revoked_at: null, expires_at: null, max_submissions: null, submission_count: 0 };
    expect(isUsableLink(base, now)).toBe(true);
    expect(isUsableLink({ ...base, revoked_at: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(isUsableLink({ ...base, is_active: false }, now)).toBe(false);
    expect(isUsableLink({ ...base, expires_at: "2026-10-05T00:00:00Z" }, now)).toBe(false);
    expect(isUsableLink({ ...base, max_submissions: 5, submission_count: 5 }, now)).toBe(false);
  });
});

describe("overall progress", () => {
  it("counts completed steps and lists what blocks completion", () => {
    const p = computeSetupProgress(snapshot());
    expect(p.completed).toBe(2);
    expect(p.total).toBe(6);
    expect(p.readyToComplete).toBe(false);
    expect(p.incompleteRequired.map((s) => s.n)).toEqual([1, 2, 6]);
    expect(describeIncomplete(p.incompleteRequired)).toMatch(/^Step 1 — Church information \(Address line 1 is required\./);
  });

  it("is ready when every required step is done, even if the optional team step is not", () => {
    const p = computeSetupProgress(snapshot({ settings: { ...savedChurch, finance_notification_email: "f@example.org" }, usableLinks: 1 }));
    expect(p.readyToComplete).toBe(true);
    expect(p.completed).toBe(5);
  });

  it("the same saved state always gives the same result (reload, another device, new deployment)", () => {
    const s = snapshot({ settings: savedChurch });
    expect(computeSetupProgress(structuredClone(s))).toEqual(computeSetupProgress(s));
  });
});
