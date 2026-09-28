'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

type Channel = 'whatsapp' | 'sms' | 'push' | 'email';

const LABEL: Record<Channel, { title: string; hint: string }> = {
  whatsapp: { title: 'WhatsApp', hint: 'Confirmations, reminders with Confirm / Cancel, changes' },
  sms: { title: 'SMS', hint: 'Backup when WhatsApp can’t reach you' },
  push: { title: 'App notifications', hint: 'When you use the APP_NAME app' },
  email: { title: 'Email', hint: 'Not used yet' },
};

/**
 * Customer notification preferences (Phase 3 Part 5 §6): booking messages always need one way to
 * reach you, so the last of WhatsApp / SMS / app can't be turned off (server-enforced).
 * Used on the web account page now and by the app later.
 */
export function NotificationPreferences() {
  const [prefs, setPrefs] = useState<Record<Channel, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().rpc('get_my_notification_preferences');
    const next = { whatsapp: true, sms: true, push: true, email: true } as Record<Channel, boolean>;
    for (const p of data ?? []) next[p.channel as Channel] = p.enabled;
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    void load().then((p) => {
      if (alive) setPrefs(p);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const set = async (channel: Channel, enabled: boolean) => {
    setError(null);
    const { error: err } = await supabase().rpc('set_notification_preference', {
      p_channel: channel,
      p_enabled: enabled,
    });
    if (err) setError(describeError(err.message));
    setPrefs(await load());
  };

  if (!prefs) return <p className="text-sm text-ink-500">Loading…</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="notification-preferences">
      {(['whatsapp', 'sms', 'push'] as Channel[]).map((c) => (
        <label key={c} className="flex items-start justify-between gap-4 text-sm">
          <span>
            <span className="font-medium">{LABEL[c].title}</span>
            <span className="block text-ink-500">{LABEL[c].hint}</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="mt-1 size-5 accent-[var(--accent-600)]"
            checked={prefs[c]}
            onChange={(e) => void set(c, e.target.checked)}
          />
        </label>
      ))}
      {error ? (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
