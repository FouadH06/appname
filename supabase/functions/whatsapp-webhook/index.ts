// WhatsApp Cloud API webhook. M4: message statuses (OTP delivery receipts). M7 adds buttons.
import { handleWhatsAppWebhook } from '../_shared/handlers.ts';
import { requireEnv, statusUpdater } from '../_shared/runtime.ts';

Deno.serve((req) =>
  handleWhatsAppWebhook(req, {
    appSecret: requireEnv('WHATSAPP_APP_SECRET'),
    verifyToken: requireEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    update: statusUpdater,
  }),
);
