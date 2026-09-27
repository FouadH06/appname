# Edge Functions

Deno functions deployed to Supabase. None exist in M0.

Planned (see `docs/phase-4/01-implementation-plan.md`):

| Function             | Milestone | Purpose                                               |
| -------------------- | --------- | ----------------------------------------------------- |
| `auth-send-sms`      | M4        | Send SMS auth hook → WhatsApp OTP with SMS fallback   |
| `notify-dispatch`    | M7        | Notification outbox dispatcher                        |
| `whatsapp-webhook`   | M7        | Delivery statuses + Confirm/Cancel buttons            |
| `media-orchestrator` | M10       | Moderation queue consumer; calls the `ImageProcessor` |

Conventions:

- Shared code lives in `_shared/`.
- Secrets come from `supabase secrets set` (local: `supabase/functions/.env`, never committed).
- Functions authenticate to Postgres with the least-privileged role that works.
