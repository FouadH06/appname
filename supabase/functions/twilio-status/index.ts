// Twilio SMS status callback → OTP delivery receipts (delivery-time metrics).
import { handleTwilioStatus } from '../_shared/handlers.ts';
import { requireEnv, statusUpdater } from '../_shared/runtime.ts';

Deno.serve((req) =>
  handleTwilioStatus(req, {
    authToken: requireEnv('TWILIO_AUTH_TOKEN'),
    // Twilio signs the exact public URL it called; inside the runtime req.url differs.
    publicUrl: requireEnv('TWILIO_STATUS_CALLBACK_URL'),
    update: statusUpdater,
  }),
);
