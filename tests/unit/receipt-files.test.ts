import { describe, expect, it } from "vitest";
import { checkReceiptFile } from "@/lib/receipt-files";

describe("receipt file validation", () => {
  it("accepts allowed types", () => {
    expect(checkReceiptFile({ name: "r.PDF", type: "application/pdf", size: 1000 })).toMatchObject({ ok: true, mime: "application/pdf", ext: "pdf" });
    expect(checkReceiptFile({ name: "IMG_1.HEIC", type: "", size: 1000 })).toMatchObject({ ok: true, mime: "image/heic" });
    expect(checkReceiptFile({ name: "a.jpeg", type: "image/jpeg", size: 1 })).toMatchObject({ ok: true, ext: "jpg" });
  });
  it("rejects wrong types, mismatches and oversize files", () => {
    expect(checkReceiptFile({ name: "virus.exe", type: "application/octet-stream", size: 10 }).ok).toBe(false);
    expect(checkReceiptFile({ name: "page.pdf", type: "text/html", size: 10 }).ok).toBe(false);
    expect(checkReceiptFile({ name: "big.png", type: "image/png", size: 11 * 1024 * 1024 }).ok).toBe(false);
    expect(checkReceiptFile({ name: "noext", type: "image/png", size: 10 }).ok).toBe(false);
  });
});
