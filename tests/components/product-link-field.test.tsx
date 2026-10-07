// @vitest-environment jsdom
/**
 * Product link on the public requisition form: every lookup state, manual
 * completion, edits, stale/expired lookups, and that nothing ever blocks
 * submission or changes the manual workflow.
 */
import "./setup";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { previewFormContext } from "@/app/dev-preview/fixtures";
import type { ActionResult } from "@/lib/action-result";
import type { ProductLookupResponse } from "@/lib/product/types";

const submitExternalRequisition = vi.fn<(...args: unknown[]) => Promise<ActionResult<unknown>>>();
const getProductDetails = vi.fn<(token: string, url: string) => Promise<ActionResult<ProductLookupResponse>>>();
vi.mock("@/app/request/[token]/actions", () => ({
  submitExternalRequisition: (...args: unknown[]) => submitExternalRequisition(...args),
  prepareReceiptUploads: vi.fn(),
}));
vi.mock("@/app/request/[token]/product-actions", () => ({
  getProductDetails: (token: string, url: string) => getProductDetails(token, url),
}));

const { RequisitionForm } = await import("@/app/request/[token]/requisition-form");
const { LOOKUP_MESSAGES } = await import("@/app/request/[token]/product-link-field");

const ctx = previewFormContext;
const FORM_TOKEN = "t".repeat(48);
const URL_A = "https://www.officedepot.com/a/products/5791037/Chair/";
const SWEETWATER = "https://www.sweetwater.com/store/detail/SM58--shure-sm58";

const renderForm = () => render(<ToastProvider><RequisitionForm token={FORM_TOKEN} context={ctx} stamp="stamp" /></ToastProvider>);
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
const change = (id: string, value: string) => fireEvent.change(el(id), { target: { value } });
const getDetails = (line = 0) => fireEvent.click(el(`items.${line}.vendor_url`).closest("div.rounded-xl")!.querySelector("button")!);
const status = (line = 0) => document.getElementById(`items.${line}.vendor_url-lookup-status`)!.textContent;
const fakeToken = (at = Date.now()) => `v1.${Buffer.from(JSON.stringify({ at })).toString("base64url")}.sig`;

const result = (over: Partial<ProductLookupResponse> = {}): ActionResult<ProductLookupResponse> => ({
  ok: true,
  data: {
    outcome: "full", domain: "officedepot.com", method: "structured_data",
    fields: { title: "Ergonomic Mesh Chair", brand: "Realspace", model: "BX-200", sku: "5791037", vendor_name: "Office Depot", color: "Black" },
    price: "249.99", currency: "USD", priceNote: null, token: fakeToken(), ...over,
  },
});

function fillRequester() {
  change("requester_name", "Jordan Example");
  change("requester_email", "jordan@example.org");
  change("requester_phone", "(555) 010-2000");
  change("department_head_name", "Jordan Example");
  change("department_id", ctx.departments[0].id);
  change("subcategory_id", ctx.departments[0].subcategories[0].id);
  change("needed_by", "2026-10-12");
  fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
  change("justification", "Equipment for Sunday production and the live stream.");
  fireEvent.click(el("certification_accepted"));
  change("certification_name", "Jordan Example");
}

async function submitAndGetItems() {
  fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
  await waitFor(() => expect(submitExternalRequisition).toHaveBeenCalledTimes(1));
  return (submitExternalRequisition.mock.calls[0][1] as { items: Record<string, string>[] }).items;
}

beforeEach(() => {
  submitExternalRequisition.mockReset();
  submitExternalRequisition.mockResolvedValue({ ok: false, error: "stop here" });
  getProductDetails.mockReset();
});

describe("product link field", () => {
  it("is optional, first in each item, with the agreed copy and a mobile-friendly layout", () => {
    renderForm();
    const input = el("items.0.vendor_url");
    expect(screen.getByText("Product link (optional)")).toBeTruthy();
    expect(screen.getByText("Paste a link and we'll fill in whatever product information we can.")).toBeTruthy();
    expect(input.type).toBe("url");
    expect(input.getAttribute("aria-required")).toBeNull();
    expect(input.getAttribute("autocapitalize")).toBe("none");
    // The link block comes before the item description.
    expect(input.compareDocumentPosition(el("items.0.description")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = screen.getByRole("button", { name: /Get details/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // no URL yet
    expect(button.className).toContain("w-full");
    expect(input.parentElement!.className).toContain("flex-col");
    // Manual fields are always visible — there is no separate mode.
    for (const id of ["description", "requested_brand", "requested_model", "requested_sku", "color", "size", "vendor_name", "quantity", "estimated_unit_price"]) {
      expect(el(`items.0.${id}`)).toBeTruthy();
    }
  });

  it("full information: fills the empty fields, marks them Filled, and submits the signed token", async () => {
    getProductDetails.mockResolvedValue(result());
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toBe("Filled from officedepot.com. Please check the details below."));
    expect(getProductDetails).toHaveBeenCalledWith(FORM_TOKEN, URL_A);
    expect(el("items.0.description").value).toBe("Ergonomic Mesh Chair");
    expect(el("items.0.requested_brand").value).toBe("Realspace");
    expect(el("items.0.requested_model").value).toBe("BX-200");
    expect(el("items.0.requested_sku").value).toBe("5791037");
    expect(el("items.0.vendor_name").value).toBe("Office Depot");
    expect(el("items.0.color").value).toBe("Black");
    expect(el("items.0.estimated_unit_price").value).toBe("249.99");
    expect(screen.getAllByText("Filled").length).toBe(7);
    fillRequester();
    const items = await submitAndGetItems();
    expect(items[0]).toMatchObject({ vendor_url: URL_A, description: "Ergonomic Mesh Chair", estimated_unit_price: "249.99", requested_brand: "Realspace" });
    expect(items[0].product_lookup).toMatch(/^v1\./);
  });

  it("partial information: fills what it has and explains a missing price", async () => {
    getProductDetails.mockResolvedValue(result({ outcome: "partial", price: null, currency: null, priceNote: "multiple", fields: { title: "Wireless Microphone", brand: "Shure" } }));
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toBe(`${LOOKUP_MESSAGES.partial} ${LOOKUP_MESSAGES.multiplePrices}`));
    expect(el("items.0.description").value).toBe("Wireless Microphone");
    expect(el("items.0.estimated_unit_price").value).toBe("");
    // Focus moves to the first required field still missing.
    await waitFor(() => expect(document.activeElement).toBe(el("items.0.estimated_unit_price")));
  });

  it("URL hints only: names the vendor and asks for the price", async () => {
    getProductDetails.mockResolvedValue(result({ outcome: "hints", domain: "sweetwater.com", method: "url_hint", price: null, currency: null, fields: { sku: "SM58", title: "Shure SM58", vendor_name: "Sweetwater" } }));
    renderForm();
    change("items.0.vendor_url", SWEETWATER);
    getDetails();
    await waitFor(() => expect(status()).toBe("We recognised this Sweetwater link and filled in what we could. Please add the price and check the details."));
    expect(el("items.0.requested_sku").value).toBe("SM58");
    expect(el("items.0.vendor_name").value).toBe("Sweetwater");
  });

  it("nothing but the domain (blocked or no data): vendor filled in, failure message, link kept", async () => {
    getProductDetails.mockResolvedValue(result({ outcome: "domain", domain: "smallshop.example", method: null, fields: {}, price: null, currency: null, token: null }));
    renderForm();
    change("items.0.vendor_url", "https://www.smallshop.example/item/9");
    getDetails();
    await waitFor(() => expect(status()).toBe(LOOKUP_MESSAGES.failed));
    expect(el("items.0.vendor_name").value).toBe("smallshop.example");
    expect(el("items.0.vendor_url").value).toBe("https://www.smallshop.example/item/9");
  });

  it.each([
    ["rate limited", () => getProductDetails.mockResolvedValue({ ok: false, error: "Too many lookups right now. Please complete the details below." }), "Too many lookups right now. Please complete the details below."],
    ["network failure / timeout", () => getProductDetails.mockRejectedValue(new Error("timeout")), LOOKUP_MESSAGES.failed],
  ])("%s: explains, keeps the link and still lets the requester submit manually", async (_label, setup, message) => {
    setup();
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toBe(message));
    expect(el("items.0.vendor_url").value).toBe(URL_A);
    fillRequester();
    change("items.0.description", "Mesh chair");
    change("items.0.quantity", "2");
    change("items.0.estimated_unit_price", "200");
    const items = await submitAndGetItems();
    expect(items[0]).toMatchObject({ vendor_url: URL_A, description: "Mesh chair", product_lookup: "" });
  });

  it("an invalid link explains itself without calling the server", async () => {
    renderForm();
    change("items.0.vendor_url", "http://insecure.example.com/x");
    getDetails();
    await waitFor(() => expect(status()).toBe(LOOKUP_MESSAGES.invalid));
    expect(getProductDetails).not.toHaveBeenCalled();
  });

  it("the requester completes missing fields manually and edits fetched ones (Edited tag)", async () => {
    getProductDetails.mockResolvedValue(result({ outcome: "partial", price: null, currency: null }));
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(el("items.0.description").value).toBe("Ergonomic Mesh Chair"));
    change("items.0.estimated_unit_price", "239.00");
    change("items.0.description", "Ergonomic Mesh Chair (black)");
    expect(screen.getAllByText("Edited")).toHaveLength(1);
    fillRequester();
    const items = await submitAndGetItems();
    expect(items[0]).toMatchObject({ description: "Ergonomic Mesh Chair (black)", estimated_unit_price: "239.00" });
    expect(items[0].product_lookup).toMatch(/^v1\./);
  });

  it("never overwrites what the requester already typed — offers the fetched value instead", async () => {
    getProductDetails.mockResolvedValue(result());
    renderForm();
    change("items.0.description", "Office chair");
    change("items.0.estimated_unit_price", "199");
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toContain("Filled from"));
    expect(el("items.0.description").value).toBe("Office chair");
    expect(el("items.0.estimated_unit_price").value).toBe("199");
    fireEvent.click(screen.getByRole("button", { name: "Use fetched value: $249.99" }));
    expect(el("items.0.estimated_unit_price").value).toBe("249.99");
    expect(screen.getByRole("button", { name: "Use fetched value: Ergonomic Mesh Chair" })).toBeTruthy();
  });

  it("multiple line items from different vendors are looked up independently", async () => {
    getProductDetails.mockImplementation(async (_t, url) =>
      url === URL_A ? result() : result({ outcome: "hints", domain: "sweetwater.com", method: "url_hint", price: null, currency: null, fields: { sku: "SM58", vendor_name: "Sweetwater" } }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    change("items.0.vendor_url", URL_A);
    change("items.1.vendor_url", SWEETWATER);
    getDetails(0);
    getDetails(1);
    await waitFor(() => expect(status(1)).toContain("Sweetwater"));
    await waitFor(() => expect(status(0)).toContain("officedepot.com"));
    expect(el("items.0.vendor_name").value).toBe("Office Depot");
    expect(el("items.1.vendor_name").value).toBe("Sweetwater");
    expect(el("items.1.estimated_unit_price").value).toBe("");
  });

  it("changing the link after a lookup drops the token and asks for Get details again", async () => {
    getProductDetails.mockResolvedValue(result());
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toContain("Filled from"));
    change("items.0.vendor_url", "https://www.officedepot.com/a/products/999/Desk/");
    expect(status()).toBe(LOOKUP_MESSAGES.stale);
    expect(screen.queryAllByText("Filled")).toHaveLength(0);
    fillRequester();
    const items = await submitAndGetItems();
    expect(items[0].product_lookup).toBe("");
    expect(items[0].description).toBe("Ergonomic Mesh Chair"); // typed values are kept
  });

  it("an expired lookup is explained but does not block submission", async () => {
    getProductDetails.mockResolvedValue(result({ token: fakeToken(Date.now() - 25 * 3600 * 1000) }));
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toBe(LOOKUP_MESSAGES.expired));
    fillRequester();
    const items = await submitAndGetItems();
    expect(items[0].description).toBe("Ergonomic Mesh Chair");
  });

  it("no product link at all: the existing manual workflow is unchanged", async () => {
    renderForm();
    fillRequester();
    change("items.0.description", "Wireless microphone system");
    change("items.0.quantity", "2");
    change("items.0.estimated_unit_price", "600");
    const items = await submitAndGetItems();
    expect(getProductDetails).not.toHaveBeenCalled();
    expect(items[0]).toMatchObject({
      description: "Wireless microphone system", quantity: "2", estimated_unit_price: "600", vendor_url: "",
      requested_brand: "", requested_model: "", requested_sku: "", product_lookup: "", priority: "medium",
    });
  });

  it("ignores a late answer for a link that was changed while loading", async () => {
    let resolve!: (r: ActionResult<ProductLookupResponse>) => void;
    getProductDetails.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderForm();
    change("items.0.vendor_url", URL_A);
    getDetails();
    await waitFor(() => expect(status()).toBe("Getting product details…"));
    change("items.0.vendor_url", "https://example.com/other");
    await act(async () => resolve(result()));
    expect(el("items.0.description").value).toBe("");
  });
});
