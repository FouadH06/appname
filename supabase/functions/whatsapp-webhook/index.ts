// WhatsApp Cloud API webhook: message statuses (OTP + booking messages) and the Confirm / Cancel
// buttons on booking reminders (M7), answered inside the customer's open session.
import { handleWhatsAppWebhook } from '../_shared/handlers.ts';
import { notifyConfigFromEnv } from '../_shared/notify/config.ts';
import { buttonHandler, env, requireEnv, statusUpdater } from '../_shared/runtime.ts';

const sender = notifyConfigFromEnv(env).whatsapp;

Deno.serve((req) =>
  handleWhatsAppWebhook(req, {
    appSecret: requireEnv('WHATSAPP_APP_SECRET'),
    verifyToken: requireEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
    update: statusUpdater,
    onButton: buttonHandler,
    reply: async (to, text) => {
      if (sender) await sender.sendText(`+${to.replace(/\D/g, '')}`, text);
    },
  }),
);
