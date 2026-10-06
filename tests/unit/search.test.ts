import { describe, expect, it } from "vitest";
import { sanitizeSearch } from "@/lib/search";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("search sanitization", () => {
  it("removes PostgREST filter grammar and wildcards", () => {
    expect(sanitizeSearch("jordan),status.eq.closed")).toBe("jordan status.eq.closed");
    expect(sanitizeSearch("100%_off*")).toBe("100 off");
    expect(sanitizeSearch(42)).toBe("");
    expect(sanitizeSearch("a".repeat(200))).toHaveLength(80);
  });
});

describe("safe redirects", () => {
  it("allows only same-origin relative paths", () => {
    expect(safeRedirectPath("/requisitions?status=submitted")).toBe("/requisitions?status=submitted");
    expect(safeRedirectPath("https://evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/\\evil.example")).toBe("/dashboard");
    expect(safeRedirectPath("/ok\nSet-Cookie:x")).toBe("/dashboard");
    expect(safeRedirectPath(null)).toBe("/dashboard");
  });
});
