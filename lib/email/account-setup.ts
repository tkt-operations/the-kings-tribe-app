import { escapeHtml, safeUrl } from "./escape";

/**
 * "Complete your account setup" — sent by an administrator to someone who
 * opened their invitation but never chose a password. Deliberately separate
 * from Supabase's "Reset your password" email (user-initiated Forgot password).
 *
 * Matches the branded Supabase auth templates: simple inline-styled layout,
 * the OFFICIAL primary navy logo PNG (unmodified, hosted with the app).
 * The link is a one-time recovery link: never log or store the output.
 */
export const ACCOUNT_SETUP_SUBJECT = "Complete your account setup | The Kings Tribe Operations";

export function renderAccountSetupEmail(link: string, appUrl: string): { subject: string; html: string; text: string } {
  const href = safeUrl(link);
  const logo = escapeHtml(`${appUrl.replace(/\/+$/, "")}/brand/logo-primary-navy.png`);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#12172D;background:#ffffff;">
  <div style="text-align:center;margin-bottom:28px;">
    <img src="${logo}" alt="The Kings Tribe" width="170" height="152" style="display:inline-block;max-width:170px;height:auto;border:0;" />
  </div>
  <h2 style="margin:0 0 16px;font-size:26px;line-height:1.25;color:#12172D;">Complete your account setup</h2>
  <p style="font-size:16px;line-height:1.6;margin:0 0 18px;">Your account for The Kings Tribe Operations is ready, but its setup has not been completed yet.</p>
  <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">Use the button below to finish setting up your account and choose your password.</p>
  <p style="margin:0 0 28px;">
    <a href="${href}" style="display:inline-block;background:#F3C94A;color:#12172D;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:8px;">Complete account setup</a>
  </p>
  <p style="font-size:14px;line-height:1.6;color:#555B6B;margin:0 0 12px;">You'll be asked to press Continue and then choose your password. This link can be used once and expires soon. If you receive another setup or password email, only the newest link will work.</p>
  <p style="font-size:14px;line-height:1.6;color:#555B6B;margin:0;">If you were not expecting this email, contact your administrator. Please don't forward it or paste the link into a messaging app.</p>
  <div style="border-top:1px solid #E5E7EB;margin-top:32px;padding-top:18px;">
    <p style="font-size:12px;line-height:1.5;color:#7A8190;margin:0;">The Kings Tribe Operations</p>
  </div>
</div>`;
  const text = [
    "Complete your account setup",
    "",
    "Your account for The Kings Tribe Operations is ready, but its setup has not been completed yet.",
    "Open the link below to finish setting up your account and choose your password:",
    "",
    link,
    "",
    "You'll be asked to press Continue and then choose your password. This link can be used once and expires soon. If you receive another setup or password email, only the newest link will work.",
    "",
    "If you were not expecting this email, contact your administrator. Please don't forward it or paste the link into a messaging app.",
    "",
    "The Kings Tribe Operations",
  ].join("\n");
  return { subject: ACCOUNT_SETUP_SUBJECT, html, text };
}
