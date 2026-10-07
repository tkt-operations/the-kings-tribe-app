import "server-only";

/** Server-only configuration. Never import this from a Client Component. */
export function serverEnv() {
  return {
    supabaseSecretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    setupToken: process.env.SETUP_TOKEN ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    emailFrom: process.env.EMAIL_FROM ?? "",
    receiptsInboundAddress: process.env.RECEIPTS_INBOUND_ADDRESS ?? "",
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET ?? "",
    // Signing secret of the Resend delivery-status webhook (/api/email-events). Server-only.
    resendDeliveryWebhookSecret: process.env.RESEND_DELIVERY_WEBHOOK_SECRET ?? "",
    // Web Push (VAPID) private key and contact subject. Server-only. Empty = push off.
    vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY ?? "").trim(),
    vapidSubject: (process.env.VAPID_SUBJECT ?? "").trim(),
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
    twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
  };
}
