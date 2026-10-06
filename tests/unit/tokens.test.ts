import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("external form tokens", async () => {
  const { generateFormToken, hashToken } = await import("@/lib/tokens");
  const { FORM_TOKEN_PATTERN } = await import("@/lib/validation/form-token");
  it("are long, URL-safe, unique, and match the accepted pattern", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateFormToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(FORM_TOKEN_PATTERN.test(t)).toBe(true);
    }
  });
  it("hash deterministically to the same hex digest the database computes", () => {
    // encode(sha256(convert_to('abc','UTF8')),'hex') in PostgreSQL
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("reject sequential or short ids", () => {
    expect(FORM_TOKEN_PATTERN.test("12")).toBe(false);
    expect(FORM_TOKEN_PATTERN.test("../../etc/passwd")).toBe(false);
  });
});
