/** FICTIONAL fixture data for development-only design previews. */
import type { FormContext } from "@/lib/data/form-context";

export const previewFormContext: FormContext = {
  church: { name: "The Kings Tribe", address_line1: "100 Example Avenue", address_line2: null, city: "Springfield", region: "IL", postal_code: "62701", country: null, phone: "(555) 010-0000", email: "finance@example.org" },
  policy: "Submit purchase requests 3–7 days before funds/items are needed whenever practical. Itemized receipts must be submitted for completed purchases.",
  currency: "USD",
  timezone: "America/Chicago",
  today: "2026-10-05",
  restricted_department_id: null,
  departments: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Production Team", subcategories: [{ id: "11111111-1111-4111-8111-111111111112", name: "Audio Production" }, { id: "11111111-1111-4111-8111-111111111113", name: "Video Production" }, { id: "11111111-1111-4111-8111-111111111114", name: "Live Sound" }] },
    { id: "22222222-2222-4222-8222-222222222222", name: "Hospitality Team", subcategories: [{ id: "22222222-2222-4222-8222-222222222223", name: "Guest Experience" }, { id: "22222222-2222-4222-8222-222222222224", name: "Welcome & Greeters" }] },
    { id: "33333333-3333-4333-8333-333333333333", name: "Children's Ministry Team", subcategories: [{ id: "33333333-3333-4333-8333-333333333334", name: "Arts & Crafts" }] },
  ],
  request_types: [
    { id: "44444444-4444-4444-8444-444444444441", key: "order", name: "Order", description: "The Finance team purchases the requested items on the department's behalf.", help_text: "Choose this when you want the church to buy the items for your team.", workflow: "church_order", is_default: true, requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: false, max_total: null },
    { id: "44444444-4444-4444-8444-444444444442", key: "direct_purchase", name: "Direct Purchase / Purchase Order", description: "The requester makes the approved purchase using a church-issued Purchase Order.", help_text: null, workflow: "purchase_order", is_default: false, requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: false, max_total: null },
    { id: "44444444-4444-4444-8444-444444444443", key: "reimbursement", name: "Reimbursement", description: "An eligible purchase has already been made and the requester asks to be repaid.", help_text: "Include the actual amount, vendor, purchase date and an itemized receipt.", workflow: "reimbursement", is_default: false, requires_receipt_on_submission: true, requires_purchase_details: true, requires_cost_center: false, max_total: null },
    { id: "44444444-4444-4444-8444-444444444444", key: "petty_cash", name: "Petty Cash", description: "Small approved cash expenses according to church policy.", help_text: null, workflow: "petty_cash", is_default: false, requires_receipt_on_submission: false, requires_purchase_details: false, requires_cost_center: false, max_total: "100.00" },
  ],
  cost_centers: [{ id: "55555555-5555-4555-8555-555555555551", code: "PROD", name: "Production Ministry", department_id: "11111111-1111-4111-8111-111111111111" }, { id: "55555555-5555-4555-8555-555555555552", code: "GEN", name: "General Operations", department_id: null }],
};
