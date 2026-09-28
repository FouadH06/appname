# Edge Functions

Deno functions deployed to Supabase. Shared code lives in `_shared/` and uses only `fetch` and
WebCrypto, so it is unit-tested under Node in `packages/edge-tests`.

| Function             | Milestone | Purpose                                                               |
| -------------------- | --------- | --------------------------------------------------------------------- |
| `auth-send-sms`      | M4        | Supabase Auth Send SMS hook → WhatsApp OTP first, Twilio SMS fallback |
| `whatsapp-webhook`   | M4 → M7   | Meta webhook: message statuses (OTP receipts); M7 adds button replies |
| `twilio-status`      | M4        | Twilio SMS status callback (OTP delivery receipts)                    |
| `notify-dispatch`    | M7        | Notification outbox dispatcher                                        |
| `media-orchestrator` | M10       | Moderation queue consumer; calls the `ImageProcessor`                 |

## OTP delivery (M4)

- Providers sit behind `OtpChannel` (`_shared/otp/types.ts`): `WhatsAppChannel` (Cloud API
  authentication template), `TwilioSmsChannel`, and `LogChannel` (local only). Replacing Twilio with
  a local SMS provider means adding one class; routing and the auth flow don't change.
- Routing state and limits live in the database (`public.otp_route`): WhatsApp by default; a
  resend after 30 s goes by SMS ("Send by SMS instead"); SMS only for `SMS_ALLOWED_PREFIXES`
  (foreign numbers stay on WhatsApp); 5 codes / 15 min and 10 / day per number.
- A WhatsApp error, or WhatsApp not configured yet, falls back to SMS in the same request.
- Every attempt and receipt is recorded in `private.otp_deliveries` (30-day retention) for the
  delivery-time metrics (`public.admin_otp_delivery_stats`).

## Secrets

Local values are in `supabase/config.toml` `[edge_runtime.secrets]` (log mode, no real
providers). Staging/production: `supabase secrets set` (see `.env.example`). Log mode is refused on
hosted projects.

All three functions verify their callers' signatures (Standard Webhooks, Meta, Twilio) and have
`verify_jwt = false` (they're called by Auth, Meta and Twilio, not by users).
