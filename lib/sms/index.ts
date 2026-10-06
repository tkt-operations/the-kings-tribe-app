import "server-only";

import { serverEnv } from "@/lib/server-env";

/**
 * SMS provider abstraction. Only Twilio is implemented; when it is not
 * configured, messages are recorded as "skipped" — never faked.
 */
export interface SmsProvider {
  readonly name: string;
  send(to: string, body: string): Promise<{ id: string }>;
}

class TwilioProvider implements SmsProvider {
  readonly name = "twilio";
  constructor(
    private readonly sid: string,
    private readonly token: string,
    private readonly from: string,
    private readonly messagingServiceSid: string,
  ) {}

  async send(to: string, body: string) {
    const params = new URLSearchParams({ To: to, Body: body });
    if (this.messagingServiceSid) params.set("MessagingServiceSid", this.messagingServiceSid);
    else params.set("From", this.from);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!response.ok || !json.sid) throw new Error(json.message ?? `Twilio HTTP ${response.status}`);
    return { id: json.sid };
  }
}

export function getSmsProvider(): SmsProvider | null {
  const env = serverEnv();
  if (env.twilioAccountSid && env.twilioAuthToken && (env.twilioFromNumber || env.twilioMessagingServiceSid)) {
    return new TwilioProvider(env.twilioAccountSid, env.twilioAuthToken, env.twilioFromNumber, env.twilioMessagingServiceSid);
  }
  return null;
}

/** Normalise to E.164. Ten-digit numbers are treated as North American (+1). */
export function toE164(phone: string, defaultCountryCode = "1"): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  return null;
}
