'use client';

import { useState } from 'react';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Notice, Section, codeOf } from '../ui';

type AlertType = 'biz_new_booking' | 'biz_new_request' | 'biz_booking_cancelled';

const ALERTS: { key: AlertType; label: string }[] = [
  { key: 'biz_new_booking', label: 'New online booking' },
  { key: 'biz_new_request', label: 'New request to accept' },
  { key: 'biz_booking_cancelled', label: 'Customer cancelled' },
];

interface Member {
  user_id: string;
  role: string;
  name: string;
  has_phone: boolean;
  me: boolean;
  alerts: Record<AlertType, boolean>;
}

/**
 * B12 · Notifications: who at the business gets WhatsApp alerts (default: owners and managers).
 * Customer messages (confirmations, reminders with Confirm / Cancel) are automatic; the "Send
 * confirmation" and "Notify" choices on each booking decide the rest.
 */
export function NotificationsSection() {
  const { business } = useBiz();
  const { data, reload } = useLoad(async () => {
    const { data: d, error } = await supabase().rpc('biz_get_notification_settings', {
      p_business_id: business.id,
    });
    if (error) throw error;
    return d as unknown as Member[];
  }, [business.id]);
  const { data: health } = useLoad(async () => {
    const { data: d } = await supabase().rpc('biz_notification_health', {
      p_business_id: business.id,
    });
    return d as { failed_7d: number; sent_7d: number } | null;
  }, [business.id]);
  const [error, setError] = useState<string | null>(null);
  // optimistic switches while the change saves
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const toggle = async (m: Member, type: AlertType, on: boolean) => {
    const key = `${m.user_id}:${type}`;
    setPending((p) => ({ ...p, [key]: on }));
    setError(null);
    const { error: err } = await supabase().rpc('biz_set_notification_setting', {
      p_business_id: business.id,
      p_user_id: m.user_id,
      p_type: type,
      p_whatsapp: on,
    });
    if (err) setError(describeError(codeOf(err)));
    await reload();
    setPending(({ [key]: _done, ...rest }) => rest);
  };

  return (
    <>
      <Section
        title="Team alerts on WhatsApp"
        description="Who gets a WhatsApp message when something happens. Owners and managers by default."
      >
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!data ? <p className="text-sm text-ink-500">Loading…</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="alert-settings">
            <thead>
              <tr className="border-b border-line-200 text-start text-xs text-ink-500">
                <th className="py-2 pe-3 text-start font-medium">Team member</th>
                {ALERTS.map((a) => (
                  <th key={a.key} className="px-2 py-2 text-center font-medium">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((m) => (
                <tr key={m.user_id} className="border-b border-line-200 last:border-0">
                  <td className="py-2 pe-3">
                    <span className="font-medium">{m.name}</span>
                    {m.me ? ' (you)' : ''}
                    <span className="block text-xs capitalize text-ink-500">
                      {m.role}
                      {!m.has_phone ? ' · no phone on the account — alerts can’t be sent' : ''}
                    </span>
                  </td>
                  {ALERTS.map((a) => (
                    <td key={a.key} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        role="switch"
                        aria-label={`${a.label} for ${m.name}`}
                        className="size-5 accent-[var(--accent-600)]"
                        checked={pending[`${m.user_id}:${a.key}`] ?? m.alerts[a.key]}
                        onChange={(e) => void toggle(m, a.key, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section
        title="Customer messages"
        description="Sent automatically on WhatsApp, with SMS as a backup for booking messages."
      >
        <ul className="list-disc ps-5 text-sm text-ink-700">
          <li>
            Confirmation when a booking is made online, or by you with “Send confirmation” on.
          </li>
          <li>
            Reminders 24 hours and 2 hours before, with Confirm and Cancel buttons (Cancel opens the
            booking page, so the customer sees your policy first).
          </li>
          <li>
            Changes you make (moved, staff changed, cancelled) when you choose to notify — always
            when the customer had chosen that staff member.
          </li>
          <li>Request accepted, declined or expired.</li>
        </ul>
        {health ? (
          <p className="text-sm text-ink-500" data-testid="delivery-health">
            Last 7 days: {health.sent_7d} sent
            {health.failed_7d ? `, ${health.failed_7d} failed` : ''}.
          </p>
        ) : null}
      </Section>
    </>
  );
}
