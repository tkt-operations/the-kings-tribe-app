import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.SUPABASE_SECRET_KEY = "test-secret-key-for-hmac";

describe("form stamps", async () => {
  const { issueFormStamp, verifyFormStamp, fingerprint } = await import("@/lib/spam");
  it("accepts a stamp after the minimum fill time", () => {
    const stamp = issueFormStamp(1_000_000_000_000);
    expect(verifyFormStamp(stamp, 1_000_000_010_000)).toBe("ok");
    expect(verifyFormStamp(stamp, 1_000_000_001_000)).toBe("too-fast");
    expect(verifyFormStamp(stamp, 1_000_000_000_000 + 25 * 3600 * 1000)).toBe("expired");
  });
  it("rejects forged or malformed stamps", () => {
    expect(verifyFormStamp("1000000000000.forged", 1_000_000_010_000)).toBe("invalid");
    expect(verifyFormStamp("garbage", 1)).toBe("invalid");
  });
  it("fingerprints are stable and do not contain the IP", () => {
    const a = fingerprint("203.0.113.9", "Safari");
    expect(a).toBe(fingerprint("203.0.113.9", "Safari"));
    expect(a).not.toContain("203");
    expect(a).not.toBe(fingerprint("203.0.113.10", "Safari"));
  });
});
