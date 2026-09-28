'use client';

import { useState } from 'react';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Notice, Section, Toggle, btn, codeOf, input } from '../ui';

/** Danger zone (owner only): pause online bookings, transfer ownership. Close business: SOON. */
export function DangerSection() {
  const { business, settings, role, refresh } = useBiz();
  const { data: members } = useLoad(async () => {
    const { data } = await supabase().rpc('list_members', { p_business_id: business.id });
    return (
      (data ?? []) as { user_id: string; display_name: string; role: string; is_me: boolean }[]
    ).filter((m) => !m.is_me);
  }, [business.id]);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (role !== 'owner') return null;

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok: string) => {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) return setMsg({ tone: 'danger', text: describeError(codeOf(error)) });
    await refresh();
    setMsg({ tone: 'success', text: ok });
  };

  return (
    <Section title="Danger zone" description="Owner only.">
      <Toggle
        label="Pause online bookings"
        description="Your profile stays visible with Call/WhatsApp buttons; customers can't book online until you resume."
        checked={settings ? !settings.allow_online_booking : false}
        disabled={busy}
        onChange={(paused) =>
          void run(
            () =>
              supabase().rpc('pause_online_booking', {
                p_business_id: business.id,
                p_paused: paused,
              }),
            paused ? 'Online bookings paused' : 'Online bookings resumed',
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Transfer ownership to</span>
          <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose a team member…</option>
            {(members ?? []).map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={btn.danger}
          disabled={busy || !target}
          onClick={() => {
            if (!window.confirm('Transfer ownership? You will become a manager.')) return;
            void run(
              () =>
                supabase().rpc('transfer_ownership', {
                  p_business_id: business.id,
                  p_new_owner_user_id: target,
                }),
              'Ownership transferred',
            );
          }}
        >
          Transfer
        </button>
      </div>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Section>
  );
}
