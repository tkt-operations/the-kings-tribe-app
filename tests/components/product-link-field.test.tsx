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
const notice = (line = 0) => document.getElementById(`items.${line}.vendor_url-previous-notice`)!.textContent;
const commitLink = (line: number, url: string) => {
  change(`items.${line}.vendor_url`, url);
  fireEvent.blur(el(`items.${line}.vendor_url`));
};
/** Text of one field's own wrapper (label, control, notes) — the money input sits inside an extra relative div. */
const fieldNote = (line: number, name: string) => {
  let wrapper = el(`items.${line}.${name}`).parentElement!;
  if (wrapper.classList.contains("relative")) wrapper = wrapper.parentElement!;
  return wrapper.textContent;
};
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

const SWEETWATER_RESULT = () => result({
  outcome: "hints", domain: "sweetwater.com", method: "url_hint", price: null, currency: null,
  fields: { title: "Shure SM58 Cardioid Dynamic Vocal Microphone", sku: "SM58", vendor_name: "Sweetwater" },
});
const OFFICE_DEPOT = "https://www.officedepot.com/a/products/273646/Office-Depot-Brand-Copier-Paper-Letter/";

async function lookUpSweetwater(line = 0) {
  getProductDetails.mockResolvedValueOnce(SWEETWATER_RESULT());
  change(`items.${line}.vendor_url`, SWEETWATER);
  getDetails(line);
  await waitFor(() => expect(status(line)).toContain("Sweetwater"));
}

describe("changing the product link (Product A → Product B)", () => {
  it("clears only untouched auto-filled values, keeps typed and edited values, and drops the token", async () => {
    renderForm();
    change("items.0.requested_brand", "Shure"); // typed BEFORE the lookup
    await lookUpSweetwater();
    expect(el("items.0.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(el("items.0.requested_sku").value).toBe("SM58");
    change("items.0.vendor_name", "Sweetwater Sound"); // auto-filled, then EDITED
    change("items.0.color", "Black"); // typed AFTER the lookup into an empty field
    commitLink(0, OFFICE_DEPOT);
    // Untouched auto-filled values from Product A are cleared.
    expect(el("items.0.description").value).toBe("");
    expect(el("items.0.requested_sku").value).toBe("");
    // Requester-entered and edited values are kept.
    expect(el("items.0.requested_brand").value).toBe("Shure");
    expect(el("items.0.color").value).toBe("Black");
    expect(el("items.0.vendor_name").value).toBe("Sweetwater Sound");
    expect(notice()).toContain(LOOKUP_MESSAGES.cleared);
    // Only the edited previous-product value carries the warning.
    expect(fieldNote(0, "vendor_name")).toContain(LOOKUP_MESSAGES.previousProduct);
    expect(fieldNote(0, "requested_brand")).not.toContain(LOOKUP_MESSAGES.previousProduct);
    expect(fieldNote(0, "color")).not.toContain(LOOKUP_MESSAGES.previousProduct);
    expect(screen.queryAllByText("Filled")).toHaveLength(0);
    // The old token / source attribution is gone.
    fillRequester();
    change("items.0.description", "Copy paper");
    change("items.0.estimated_unit_price", "79.99");
    const items = await submitAndGetItems();
    expect(items[0]).toMatchObject({ vendor_url: OFFICE_DEPOT, product_lookup: "", description: "Copy paper", requested_sku: "", vendor_name: "Sweetwater Sound" });
  });

  it("does not clear on each keystroke; typing back the same link restores the token and clears nothing", async () => {
    renderForm();
    await lookUpSweetwater();
    change("items.0.vendor_url", `${SWEETWATER}x`);
    expect(status()).toBe(LOOKUP_MESSAGES.linkChanged);
    expect(el("items.0.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    change("items.0.vendor_url", SWEETWATER);
    fireEvent.blur(el("items.0.vendor_url"));
    expect(el("items.0.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(notice()).toBe("");
    fillRequester();
    change("items.0.quantity", "1");
    change("items.0.estimated_unit_price", "99");
    const items = await submitAndGetItems();
    expect(items[0].product_lookup).toMatch(/^v1\./);
  });

  it("treats the same link written differently (case, trailing #fragment) as the same product", async () => {
    renderForm();
    await lookUpSweetwater();
    commitLink(0, `${SWEETWATER.replace("www.sweetwater.com", "WWW.Sweetwater.com")}#reviews`);
    expect(el("items.0.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(notice()).toBe("");
  });

  it("a link change that was never committed is applied on Submit (e.g. Enter in the link field)", async () => {
    renderForm();
    await lookUpSweetwater();
    fillRequester();
    change("items.0.quantity", "1");
    change("items.0.estimated_unit_price", "99");
    change("items.0.vendor_url", OFFICE_DEPOT); // no blur
    fireEvent.click(screen.getByRole("button", { name: "Submit requisition" }));
    // The stale Sweetwater description was cleared, so the form asks for it instead of submitting Product A's data.
    await waitFor(() => expect(el("items.0.description").value).toBe(""));
    expect(submitExternalRequisition).not.toHaveBeenCalled();
  });

  it("Undo restores cleared values only into empty fields and never restores the token", async () => {
    renderForm();
    await lookUpSweetwater();
    commitLink(0, OFFICE_DEPOT);
    change("items.0.description", "Copy paper"); // typed since the clear
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(el("items.0.description").value).toBe("Copy paper"); // not overwritten
    expect(el("items.0.requested_sku").value).toBe("SM58"); // restored into an empty field
    expect(el("items.0.vendor_name").value).toBe("Sweetwater");
    expect(notice()).toBe(LOOKUP_MESSAGES.restored);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(fieldNote(0, "requested_sku")).toContain(LOOKUP_MESSAGES.previousProduct);
    fillRequester();
    change("items.0.estimated_unit_price", "79.99");
    const items = await submitAndGetItems();
    expect(items[0].product_lookup).toBe("");
  });

  it("a failed new lookup keeps the previous product's details cleared and says so", async () => {
    renderForm();
    await lookUpSweetwater();
    getProductDetails.mockResolvedValueOnce(result({ outcome: "domain", domain: "officedepot.com", method: null, fields: {}, price: null, currency: null, token: null }));
    change("items.0.vendor_url", OFFICE_DEPOT);
    getDetails(); // paste + Get details, without leaving the field first
    await waitFor(() => expect(status()).toBe(LOOKUP_MESSAGES.failed));
    expect(el("items.0.description").value).toBe("");
    expect(el("items.0.requested_sku").value).toBe("");
    expect(el("items.0.vendor_name").value).toBe("officedepot.com"); // cleared, then refilled for the new link
    expect(notice()).toContain(LOOKUP_MESSAGES.cleared);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull(); // no mixing once a new lookup ran
  });

  it("a new lookup fills the fields cleared from the previous product", async () => {
    renderForm();
    await lookUpSweetwater();
    getProductDetails.mockResolvedValueOnce(result({
      outcome: "hints", domain: "officedepot.com", method: "url_hint", price: null, currency: null,
      fields: { title: "Office Depot Brand Copier Paper Letter", sku: "273646", vendor_name: "Office Depot" },
    }));
    change("items.0.vendor_url", OFFICE_DEPOT);
    getDetails();
    await waitFor(() => expect(status()).toContain("Office Depot"));
    expect(el("items.0.description").value).toBe("Office Depot Brand Copier Paper Letter");
    expect(el("items.0.requested_sku").value).toBe("273646");
    expect(el("items.0.vendor_name").value).toBe("Office Depot");
    expect(notice()).toBe("");
    expect(screen.getAllByText("Filled")).toHaveLength(3);
  });

  it("the previous-product warning stays on an edited field until the requester changes it again", async () => {
    renderForm();
    await lookUpSweetwater();
    change("items.0.description", "SM58 microphone (black)");
    commitLink(0, OFFICE_DEPOT);
    expect(el("items.0.description").value).toBe("SM58 microphone (black)");
    expect(notice()).toContain(LOOKUP_MESSAGES.cleared); // SKU and vendor were cleared
    expect(fieldNote(0, "description")).toContain(LOOKUP_MESSAGES.previousProduct);
    change("items.0.description", "Copy paper");
    expect(fieldNote(0, "description")).not.toContain(LOOKUP_MESSAGES.previousProduct);
  });

  it("only edited fields kept: explains that some details came from the previous product", async () => {
    getProductDetails.mockResolvedValueOnce(result({ outcome: "hints", domain: "sweetwater.com", method: "url_hint", price: null, currency: null, fields: { sku: "SM58" } }));
    renderForm();
    change("items.0.vendor_url", SWEETWATER);
    getDetails();
    await waitFor(() => expect(el("items.0.requested_sku").value).toBe("SM58"));
    change("items.0.requested_sku", "SM58-LC");
    commitLink(0, OFFICE_DEPOT);
    expect(notice()).toBe(LOOKUP_MESSAGES.changedKept);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("changing one line's link never affects another line", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    await lookUpSweetwater(0);
    await lookUpSweetwater(1);
    commitLink(0, OFFICE_DEPOT);
    expect(el("items.0.description").value).toBe("");
    expect(el("items.1.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(el("items.1.requested_sku").value).toBe("SM58");
    expect(notice(1)).toBe("");
    expect(status(1)).toContain("Sweetwater");
  });

  it("removing a line forgets its lookup without touching the others", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    await lookUpSweetwater(1);
    fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[0]);
    expect(el("items.0.description").value).toBe("Shure SM58 Cardioid Dynamic Vocal Microphone");
    expect(status(0)).toContain("Sweetwater");
  });
});
