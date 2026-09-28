// Supabase Auth "Send SMS" hook: delivers phone OTPs by WhatsApp first, SMS as fallback.
// Config: [auth.hook.send_sms] (local: supabase/config.toml; hosted: Dashboard → Auth → Hooks).
import { handleSendSmsHook } from '../_shared/handlers.ts';
import { otpConfigFromEnv } from '../_shared/otp/config.ts';
import { deliverOtp } from '../_shared/otp/router.ts';
import { postgrestOtpStore } from '../_shared/otp/store.ts';
import { assertLogModeIsLocal, requireEnv, serviceRpcTarget, env } from '../_shared/runtime.ts';

assertLogModeIsLocal();
const config = otpConfigFromEnv(env);
const { url, key } = serviceRpcTarget();
const store = postgrestOtpStore(url, key);

Deno.serve((req) =>
  handleSendSmsHook(req, {
    hookSecrets: requireEnv('SEND_SMS_HOOK_SECRETS'),
    deliver: (m) =>
      deliverOtp(m, { store, channels: config.channels, smsPrefixes: config.smsPrefixes }),
    log: (line) => console.log(line),
  }),
);
