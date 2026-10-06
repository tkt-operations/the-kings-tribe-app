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
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? "",
    twilioMessagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? "",
  };
}
