import { describe, expect, it } from "vitest";
import { bareEmail, buildReplyAddress, findDocumentNumbers, parseReplyAddress } from "@/lib/inbound/address";
import { escapeHtml, safeUrl } from "@/lib/email/escape";
import { renderEmail } from "@/lib/email/layout";

describe("reply addresses", () => {
  const token = "0123456789abcdef01234567";
  it("round-trips plus addresses", () => {
    const address = buildReplyAddress("receipts@inbound.example.org", { kind: "po", token })!;
    expect(address).toBe(`receipts+po-${token}@inbound.example.org`);
    expect(parseReplyAddress(`Finance <${address}>`)).toEqual({ kind: "po", token });
    expect(parseReplyAddress(`receipts+req-${token.toUpperCase()}@x.org`)).toEqual({ kind: "req", token });
  });
  it("rejects malformed tokens and bases", () => {
    expect(buildReplyAddress("receipts@x.org", { kind: "po", token: "short" })).toBeNull();
    expect(buildReplyAddress("not-an-email", { kind: "po", token })).toBeNull();
    expect(parseReplyAddress("receipts@x.org")).toBeNull();
    expect(parseReplyAddress(`receipts+po-${token}0@x.org`)).toBeNull();
  });
  it("finds document numbers in subjects and bodies", () => {
    expect(findDocumentNumbers("Re: Purchase Order TKT-PO-2026-0007 for TKT-REQ-2026-0042")).toEqual({
      poNumber: "TKT-PO-2026-0007",
      requisitionNumber: "TKT-REQ-2026-0042",
    });
    expect(findDocumentNumbers("receipt attached")).toEqual({ poNumber: null, requisitionNumber: null });
    expect(bareEmail("Jordan <Jordan@Example.org>")).toBe("jordan@example.org");
  });
});

describe("email rendering", () => {
  it("escapes all user-provided content", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    const { html, text } = renderEmail(
      {
        preheader: "p",
        heading: "Hello <b>",
        paragraphs: ['<img src=x onerror="alert(1)">'],
        items: [{ description: "<i>Mic</i>", quantity: "1", amount: "$5.00" }],
        cta: { label: "Open", url: "javascript:alert(1)" },
      },
      { appUrl: "https://ops.example.org", churchName: "The Kings Tribe", churchLines: ["1 Main St"] },
    );
    expect(html).not.toMatch(/<img src=x|<i>Mic|<b>|javascript:/);
    expect(html).toContain("https://ops.example.org/brand/logo-primary-gold-on-navy.png");
    expect(text).toContain("<i>Mic</i>"); // plain-text part is not HTML
  });
});
