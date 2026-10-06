import { describe, expect, it } from "vitest";
import { renderPurchaseOrderPdf } from "@/lib/pdf/purchase-order";

describe("purchase order PDF", () => {
  it("renders a valid PDF document", async () => {
    const pdf = await renderPurchaseOrderPdf({
      poNumber: "TKT-PO-2026-0001",
      requisitionNumber: "TKT-REQ-2026-0001",
      issueDate: "Oct 5, 2026",
      church: { name: "The Kings Tribe", lines: ["100 Example Ave", "Springfield", "(555) 010-0000", "finance@example.org"] },
      vendor: { name: "Coffee Co", contact: null, email: "orders@coffee.example", phone: null, address: null, url: "https://coffee.example" },
      department: "Hospitality Team",
      subcategory: "Guest Experience",
      requestType: "Order",
      requester: { name: "Jordan Example", email: "jordan@example.org", phone: "(555) 010-2000" },
      neededBy: "Oct 12, 2026",
      costCenter: "HOSP — Hospitality Ministry",
      expenseCategory: "Food & Refreshments",
      items: Array.from({ length: 30 }, (_, i) => ({
        line: i + 1, description: `Item ${i + 1}`, detail: i % 3 === 0 ? "Specs: large · Color: navy" : null, quantity: "2", unitPrice: "$10.00", lineTotal: "$20.00",
      })),
      total: "$600.00",
      approval: { approvedBy: "Head of Finance", approvedOn: "Oct 4, 2026", issuedBy: "Head of Finance" },
      notes: "Deliver to the church office.",
      instructions: "Retain itemized receipts.",
      footer: "This Purchase Order authorizes only the items listed.",
      isDemo: true,
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(20_000); // fonts + logo embedded
  });
});
