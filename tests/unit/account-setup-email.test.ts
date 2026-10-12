import { describe, expect, it } from "vitest";
import { ACCOUNT_SETUP_SUBJECT, renderAccountSetupEmail } from "@/lib/email/account-setup";

const LINK = `https://ops.thekingstribe.org/auth/callback?next=/auth/update-password#token_hash=${"ab".repeat(28)}&type=recovery`;

describe("Complete your account setup email", () => {
  const mail = renderAccountSetupEmail(LINK, "https://ops.thekingstribe.org/");

  it("subject and heading say setup, not password reset", () => {
    expect(mail.subject).toBe(ACCOUNT_SETUP_SUBJECT);
    expect(ACCOUNT_SETUP_SUBJECT).toBe("Complete your account setup | The Kings Tribe Operations");
    expect(mail.html).toContain("Complete your account setup</h2>");
    expect(mail.html + mail.text).not.toMatch(/reset your password/i);
  });

  it("CTA points at the protected link (HTML-escaped in markup, raw in text)", () => {
    expect(mail.html).toContain(`href="${LINK.replaceAll("&", "&amp;")}"`);
    expect(mail.html).toContain(">Complete account setup</a>");
    expect(mail.text).toContain(LINK);
  });

  it("uses the official logo by absolute HTTPS URL, with alt text and fixed dimensions", () => {
    expect(mail.html).toContain('src="https://ops.thekingstribe.org/brand/logo-primary-navy.png"');
    expect(mail.html).toContain('alt="The Kings Tribe"');
    expect(mail.html).toContain('width="170" height="152"');
    expect(mail.html).not.toMatch(/<svg|<script|<style|<link /i);
  });

  it("refuses non-http links", () => {
    expect(renderAccountSetupEmail("javascript:alert(1)", "https://ops.thekingstribe.org").html).toContain('href="#"');
  });
});
