import { describe, expect, it } from "vitest";
import { canReissueInvitation, hasActivatedAccount, userState } from "@/lib/user-state";

describe("user state model", () => {
  it("activation comes from email_confirmed_at or last_sign_in_at", () => {
    expect(hasActivatedAccount({ email_confirmed_at: null, last_sign_in_at: null })).toBe(false);
    expect(hasActivatedAccount({})).toBe(false);
    expect(hasActivatedAccount({ email_confirmed_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(hasActivatedAccount({ last_sign_in_at: "2026-10-01T00:00:00Z" })).toBe(true);
  });

  it.each([
    [false, true, "pending", true],
    [true, true, "active", false],
    [true, false, "deactivated", false],
    [false, false, "pending_deactivated", false],
  ] as const)("activated=%s isActive=%s → %s (re-invite allowed: %s)", (activated, isActive, state, reissue) => {
    expect(userState({ activated, isActive })).toBe(state);
    expect(canReissueInvitation(userState({ activated, isActive }))).toBe(reissue);
  });
});
