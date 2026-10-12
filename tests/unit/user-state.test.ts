import { describe, expect, it } from "vitest";
import { isEmailConfirmed, setupChannel, userState } from "@/lib/user-state";

describe("user state model (app-level setup marker)", () => {
  it.each([
    [false, true, "pending_setup"],
    [true, true, "active"],
    [false, false, "deactivated_pending"],
    [true, false, "deactivated_active"],
  ] as const)("setupCompleted=%s isActive=%s → %s", (setupCompleted, isActive, state) => {
    expect(userState({ setupCompleted, isActive })).toBe(state);
  });

  it("Supabase confirmation alone never activates: invite clicked, no password chosen → still pending", () => {
    // email_confirmed_at and last_sign_in_at are set by opening the link; they are not inputs to the state.
    expect(userState({ setupCompleted: false, isActive: true })).toBe("pending_setup");
  });

  it("pending + unconfirmed → invitation; pending + confirmed → recovery", () => {
    expect(setupChannel("pending_setup", false)).toBe("invite");
    expect(setupChannel("pending_setup", true)).toBe("recovery");
  });

  it.each(["active", "deactivated_pending", "deactivated_active"] as const)("%s → no setup link", (state) => {
    expect(setupChannel(state, false)).toBeNull();
    expect(setupChannel(state, true)).toBeNull();
  });

  it("isEmailConfirmed reads email_confirmed_at only (Supabase's own rule)", () => {
    expect(isEmailConfirmed({ email_confirmed_at: "2026-10-09T00:32:38Z" })).toBe(true);
    expect(isEmailConfirmed({ email_confirmed_at: null })).toBe(false);
    expect(isEmailConfirmed({})).toBe(false);
  });
});
