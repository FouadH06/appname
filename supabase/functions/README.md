# Edge Functions

Deno functions deployed to Supabase. Shared code lives in `_shared/` and uses only `fetch` and
WebCrypto, so it is unit-tested under Node in `packages/edge-tests`.

| Function             | Milestone | Purpose                                                                           |
| -------------------- | --------- | --------------------------------------------------------------------------------- |
| `auth-send-sms`      | M4        | Supabase Auth Send SMS hook → WhatsApp OTP first, Twilio SMS fallback             |
| `whatsapp-webhook`   | M4 → M7   | Meta webhook: message statuses (OTP + booking receipts), Confirm / Cancel buttons |
| `twilio-status`      | M4        | Twilio SMS status callback (OTP delivery receipts)                                |
| `notify-dispatch`    | M7        | Notification outbox dispatcher                                                    |
| `moderate`           | M9        | Review/reply text moderation + on-demand translations (pgmq queues)               |
| `media-orchestrator` | M10       | Moderation queue consumer; calls the `ImageProcessor`                             |

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

## Booking messages (M7)

- The database decides what to send: a trigger on `booking_events` fills `public.notifications`
  (confirmations, request outcomes, changes, reminders 24 h / 2 h, business alerts).
- `notify-dispatch` (pg_cron every minute via pg_net, shared secret `NOTIFY_DISPATCH_SECRET` also
  stored in Vault) claims due rows (`notify_claim`, skip-locked), renders per locale in Beirut time
  (`_shared/notify/render.ts`), sends WhatsApp templates with Confirm / Cancel quick replies, falls
  back to SMS for critical types, and reports attempts (`notify_record_attempt`, `notify_finish`).
- Providers sit behind `WhatsAppSender` / `SmsSender` (`_shared/notify/types.ts`); local and CI use
  the log senders (`OTP_PROVIDER_MODE=log` / `NOTIFY_PROVIDER_MODE=log`).
- WhatsApp templates must be approved by Meta; submit the copy from
  `supabase/migrations/20261003100100_m7_templates.sql`, then mark each row `approved`.

## Review moderation (M9)

- Submitting a review publishes the star rating at once (after the in-database fraud pre-check); the
  comment is queued (`pgmq` queue `moderation`) and only shown once `moderate` approves it.
- `moderate` (pg_cron every minute via pg_net while a queue has work; shared secret
  `MODERATE_SECRET`, also in Vault as `moderate_secret` + `moderate_url`) claims jobs
  (`moderation_claim`), runs `_shared/moderation/`: rules (contact details in any digit script,
  links, spam phrases) → normalisation / language detection (ar, en, fr, Arabizi, mixed) →
  classifier → decision matrix (`decide.ts`), and records every stage (`moderation_record`, applied
  only if the text is unchanged). Unsure cases open a moderation case for admins (A2/A3).
- Classifier: `ClaudeClassifier` (official `@anthropic-ai/sdk`, model `LLM_MODEL`, default
  `claude-opus-5`, structured JSON output, cached system prompt, server-side `fallbacks: "default"`;
  a refusal or unusable answer → human; network errors → retried by the queue). Without
  `ANTHROPIC_API_KEY`: `HeuristicClassifier` (keywords) — on a hosted project in strict mode, so no
  comment is published without either the LLM or a moderator.
- Quality: `packages/edge-tests/eval/` — 206 labelled reviews + 30 held out; `EVAL_LLM=1
ANTHROPIC_API_KEY=… pnpm --filter @app/edge-tests test moderation-eval` scores the LLM.
- Translations: `request_translation` (cached per text + language) → queue `translate` → Claude.

## Secrets

Local values are in `supabase/config.toml` `[edge_runtime.secrets]` (log mode, no real
providers). Staging/production: `supabase secrets set` (see `.env.example`). Log mode is refused on
hosted projects.

All three functions verify their callers' signatures (Standard Webhooks, Meta, Twilio) and have
`verify_jwt = false` (they're called by Auth, Meta and Twilio, not by users).
