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
  `claude-sonnet-5`, structured JSON output, cached system prompt, server-side `fallbacks: "default"`;
  a refusal or unusable answer → human; network errors → retried by the queue). Without
  `ANTHROPIC_API_KEY`: `HeuristicClassifier` (keywords), strict outside the local stack.
- **Auto-publication** (no moderator): keyword classifier only on the local stack; Claude only with
  `MODERATION_AUTO_PUBLISH=true`, set after the model passes the eval gate. Otherwise every comment
  that isn't rejected waits for a moderator (star ratings are unaffected).
- Quality: `packages/edge-tests/eval/` — 206 labelled reviews + 150 blind held out; gate = 0 harmful held-out
  comments published; `EVAL_LLM=1
ANTHROPIC_API_KEY=… pnpm --filter @app/edge-tests test moderation-eval` scores the LLM.
- Translations: `request_translation` (cached per text + language) → queue `translate` → Claude.

## Customer photos (M10)

Private-first: a photo is never public before a decision.

1. `request_review_media_upload` (consent recorded) → the client uploads a ≤ 2048 px JPEG to
   `ugc-private/{user}/{id}.jpg` (storage policy: only that registered path) → `finalize_media_upload`
   → queue `media_transform`.
2. **Transform worker** (`apps/media-worker`, Node + sharp/libvips, Docker; chosen by the M10 benchmark
   over Edge Functions): `media_claim_transform` → decode (JPEG/PNG/WebP; HEVC HEIC via libheif's
   `heif-dec`/`heif-convert`), orientation, strip all metadata, `thumb`/`card`/`full` WebP to
   `ugc-staging`, pHash + blurhash → `media_processing_complete` (idempotent per job). Hash stage in
   SQL: exact/near duplicates (pHash Hamming distance) → human.
3. **`media-orchestrator`** (pg_cron via pg_net, `x-media-secret` = `MEDIA_ORCHESTRATOR_SECRET`, Vault
   `media_orchestrator_url` / `media_orchestrator_secret`): queue `media_classify` → `ImageClassifier`
   (`ClaudeImageClassifier`: safety, OCR/contact details/QR/documents, relevance to the booked service,
   minors; structured output, cached system prompt) → `decideImage` → `media_classification_record`;
   queue `media_publish` copies derivatives to `ugc-public` → `media_publish_complete`; queue
   `media_cleanup` deletes staging/public objects.
4. **Auto-publication**: the local stub only on the local stack; Claude only with
   `MEDIA_AUTO_PUBLISH=true` (after the labelled image eval passes). Hosted without a key: every photo
   goes to a moderator (A3 image case, blurred by default).
5. Removal (customer, moderator, account deletion) → public derivatives deleted by the cleanup queue.

Quality: `packages/edge-tests/eval/image-evaluate.ts` — labelled set kept outside Git
(`IMAGE_EVAL_DIR`, see `image-labels.example.json`); `EVAL_IMAGES=1 IMAGE_EVAL_DIR=… ANTHROPIC_API_KEY=…
pnpm --filter @app/edge-tests test media-eval`; gate = ≥ 90 % of automatic decisions correct and 0
falsely public.

## Secrets

Local values are in `supabase/config.toml` `[edge_runtime.secrets]` (log mode, no real
providers). Staging/production: `supabase secrets set` (see `.env.example`). Log mode is refused on
hosted projects.

All three functions verify their callers' signatures (Standard Webhooks, Meta, Twilio) and have
`verify_jwt = false` (they're called by Auth, Meta and Twilio, not by users).
