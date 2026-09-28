import { rpc } from '../otp/store.ts';
import type { Fetch } from '../otp/types.ts';
import { fill, formatVars, templateButtons, whatsappParams } from './render.ts';
import type { Claimed, NotifyStore, Outcome, SmsSender, WhatsAppSender } from './types.ts';

export interface DispatchDeps {
  store: NotifyStore;
  whatsapp?: WhatsAppSender;
  sms?: SmsSender;
  /** live: only Meta-approved WhatsApp templates are sent; log: everything is printed */
  mode: 'live' | 'log';
  limit?: number;
  log?: (line: string) => void;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
}

/**
 * One dispatcher run: claim due rows (skip-locked in the database, so parallel or repeated runs
 * never send the same row twice), then per row try the channels in order — WhatsApp, then SMS for
 * critical messages — recording every attempt, and report the outcome (retry with backoff for
 * temporary provider errors).
 */
export async function runDispatch(deps: DispatchDeps): Promise<DispatchSummary> {
  const rows = await deps.store.claim(deps.limit ?? 50);
  const summary: DispatchSummary = { claimed: rows.length, sent: 0, retry: 0, failed: 0 };
  for (const n of rows) {
    let outcome: Outcome;
    let error: string | null = null;
    try {
      ({ outcome, error } = await deliver(n, deps));
    } catch (e) {
      outcome = 'retry';
      error = e instanceof Error ? e.message : String(e);
    }
    await deps.store.finish(n.id, outcome, error);
    summary[outcome] += 1;
  }
  if (rows.length) deps.log?.(`notify: ${JSON.stringify(summary)}`);
  return summary;
}

async function deliver(
  n: Claimed,
  deps: DispatchDeps,
): Promise<{ outcome: Outcome; error: string | null }> {
  const vars = formatVars(n.payload, n.locale);
  let lastError = n.channels.length ? '' : 'no enabled channel';
  let retryable = false;

  for (const channel of n.channels) {
    const t = n.templates[channel];
    if (!t) {
      lastError = `no ${channel} template`;
      continue;
    }
    if (channel === 'whatsapp') {
      if (!deps.whatsapp) {
        lastError = 'whatsapp not configured';
        continue;
      }
      if (deps.mode === 'live' && (t.status !== 'approved' || !t.provider_template_name)) {
        lastError = `whatsapp template ${t.type}/${t.locale} not approved`;
        continue;
      }
      const r = await deps.whatsapp.sendTemplate(
        n.phone,
        t.provider_template_name ?? t.type,
        t.locale,
        whatsappParams(t, vars),
        templateButtons(t, n.payload),
      );
      await deps.store.recordAttempt(
        n.id,
        'whatsapp',
        deps.whatsapp.provider,
        r.ok ? r.messageId : null,
        r.ok,
        r.ok ? null : r.error,
      );
      if (r.ok) return { outcome: 'sent', error: null };
      lastError = r.error;
      retryable ||= r.retryable;
    } else {
      if (!deps.sms) {
        lastError = 'sms not configured';
        continue;
      }
      const r = await deps.sms.sendText(n.phone, fill(t.body, vars));
      await deps.store.recordAttempt(
        n.id,
        'sms',
        deps.sms.provider,
        r.ok ? r.messageId : null,
        r.ok,
        r.ok ? null : r.error,
      );
      if (r.ok) return { outcome: 'sent', error: null };
      lastError = r.error;
      retryable ||= r.retryable;
    }
  }
  return { outcome: retryable ? 'retry' : 'failed', error: lastError };
}

/** Outbox RPCs through PostgREST with the service key (service_role only in the database). */
export function postgrestNotifyStore(
  supabaseUrl: string,
  serviceKey: string,
  fetchFn: Fetch = fetch,
): NotifyStore {
  const call = <T>(name: string, args: Record<string, unknown>) =>
    rpc<T>(fetchFn, supabaseUrl, serviceKey, name, args);
  return {
    claim: async (limit) =>
      (await call<Claimed[] | null>('notify_claim', { p_limit: limit })) ?? [],
    recordAttempt: async (id, channel, provider, messageId, ok, error) => {
      await call('notify_record_attempt', {
        p_notification_id: id,
        p_channel: channel,
        p_provider: provider,
        p_message_id: messageId,
        p_ok: ok,
        p_error: error,
      });
    },
    finish: async (id, outcome, error) => {
      await call('notify_finish', { p_notification_id: id, p_outcome: outcome, p_error: error });
    },
  };
}
