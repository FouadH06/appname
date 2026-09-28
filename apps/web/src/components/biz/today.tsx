'use client';

import Link from 'next/link';
import { useState } from 'react';
import { STATUS_LABEL, actions, loadCalendar, type BookingCard } from '@/lib/biz/bookings';
import { dayFrame, overlapsDay, timeLabel } from '@/lib/biz/calendar';
import { useBiz } from '@/lib/biz/context';
import { beirutToday, loadStaff } from '@/lib/biz/data';
import { useBookingChanges } from '@/lib/biz/realtime';
import { useLoad } from '@/lib/biz/use-load';
import { useNow } from '@/lib/biz/use-now';
import { supabase } from '@/lib/supabase';
import { BookingDrawer, bookingError } from './booking-drawer';
import { Toasts, useToasts } from './overlay';
import { Section, btn } from './ui';

interface TodaySummary {
  date: string;
  pending_requests: number;
  unmarked_past: string[];
  contested_no_shows: number;
  appointments: number;
  cancellations: number;
  expected_revenue: { amount: number; approx: boolean; currency: string } | null;
  utilization: number | null;
}

/** B2 Overview (lean) / staff "My day": needs attention → today → tiles. */
export function Today() {
  const { business, location, role, settings } = useBiz();
  const desk = role !== 'staff';
  const base = `/biz/${business.id}`;
  const now = useNow();
  const { toasts, push, dismiss } = useToasts();
  const [open, setOpen] = useState<string | null>(null);
  const today = beirutToday();
  const { data, reload } = useLoad(async () => {
    if (!location) return null;
    const [sum, cal] = await Promise.all([
      supabase().rpc('biz_today', { p_business_id: business.id }),
      loadCalendar(location.id, today, today, null, false),
    ]);
    return { sum: sum.data as unknown as TodaySummary, cal };
  }, [business.id, location?.id, today]);
  const { data: staff } = useLoad(() => loadStaff(business.id), [business.id]);
  // B2 attention: customer messages failing (delivery problem to look into)
  const { data: health } = useLoad(async () => {
    if (!desk) return null;
    const { data: h } = await supabase().rpc('biz_notification_health', {
      p_business_id: business.id,
    });
    return h as { failed_7d: number; sent_7d: number } | null;
  }, [business.id, desk]);
  const failing = health?.failed_7d ?? 0;
  useBookingChanges(business.id, () => void reload());

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      push({ text: msg });
      await reload();
    } catch (e) {
      push({ text: bookingError(e).text, tone: 'danger' });
    }
  };

  if (!data) return <p className="text-sm text-ink-500">Loading today…</p>;
  const { sum, cal } = data;
  const frame = dayFrame(today);
  const rows: BookingCard[] = cal.items
    .filter((i) => overlapsDay(frame, i.starts_at, i.ends_at) && i.status !== 'held')
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const next = rows.find(
    (r) => Date.parse(r.ends_at) > now && (r.status === 'confirmed' || r.status === 'pending'),
  );
  const closed = cal.staff.every((s) => !s.working.some(([a, b]) => overlapsDay(frame, a, b)));

  return (
    <>
      {sum.pending_requests || sum.unmarked_past.length || sum.contested_no_shows || failing ? (
        <Section title="Needs attention">
          <ul className="flex flex-col gap-2 text-sm" data-testid="attention">
            {sum.pending_requests && desk ? (
              <li className="flex items-center justify-between">
                <span>
                  {sum.pending_requests} pending request{sum.pending_requests === 1 ? '' : 's'}
                </span>
                <Link className={btn.link} href={`${base}/bookings`}>
                  Review
                </Link>
              </li>
            ) : null}
            {sum.unmarked_past.length ? (
              <li className="flex items-center justify-between">
                <span>
                  {sum.unmarked_past.length} past appointment
                  {sum.unmarked_past.length === 1 ? '' : 's'} not marked
                </span>
                <button
                  type="button"
                  className={btn.link}
                  onClick={() =>
                    void act(() => actions.completeMany(sum.unmarked_past), 'Marked completed')
                  }
                >
                  Mark all completed
                </button>
              </li>
            ) : null}
            {failing ? (
              <li className="flex items-center justify-between" data-testid="messages-failing">
                <span>
                  {failing} customer message{failing === 1 ? '' : 's'} couldn’t be delivered this
                  week (WhatsApp and SMS)
                </span>
                {role === 'owner' || role === 'manager' ? (
                  <Link className={btn.link} href={`${base}/settings?section=notifications`}>
                    Details
                  </Link>
                ) : null}
              </li>
            ) : null}
            {sum.contested_no_shows ? (
              <li>
                {sum.contested_no_shows} contested no-show{sum.contested_no_shows === 1 ? '' : 's'}{' '}
                (APP_NAME support is reviewing)
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="today-tiles">
        <Tile label="Appointments" value={String(sum.appointments)} />
        {sum.expected_revenue ? (
          <Tile
            label="Expected revenue"
            value={`${sum.expected_revenue.approx ? '~' : ''}$${Number(sum.expected_revenue.amount).toFixed(0)}`}
          />
        ) : null}
        <Tile label="Booked" value={sum.utilization === null ? '—' : `${sum.utilization}%`} />
        <Tile label="Cancellations" value={String(sum.cancellations)} />
      </div>

      <Section title={role === 'staff' ? 'My day' : 'Today'}>
        {closed && !rows.length ? (
          <p className="text-sm text-ink-500">Closed today.</p>
        ) : !rows.length ? (
          <div className="flex flex-col gap-2 text-sm text-ink-500">
            <p>
              No appointments today.
              {business.status === 'live' && settings?.allow_online_booking
                ? ' Share your booking link to get your first online booking.'
                : ''}
            </p>
            <Link className={btn.secondary + ' self-start'} href={`${base}/calendar`}>
              Open calendar
            </Link>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-line-200 text-sm" data-testid="today-list">
            {rows.map((b) => {
              const started = Date.parse(b.starts_at) <= now;
              return (
                <li
                  key={b.item_id}
                  className={`flex flex-wrap items-center gap-2 py-2 ${b.item_id === next?.item_id ? 'font-medium' : ''}`}
                >
                  <button
                    type="button"
                    className="flex min-w-[12rem] flex-1 items-center gap-3 text-start"
                    onClick={() => setOpen(b.booking_id)}
                  >
                    <span className="w-16 shrink-0">{timeLabel(b.starts_at)}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{b.customer?.name ?? 'Walk-in'}</span>
                      <span className="truncate text-xs font-normal text-ink-500">
                        {b.service_name}
                        {role !== 'staff' ? ` · ${b.staff_name}` : ''} ·{' '}
                        {b.item_id === next?.item_id ? 'Next · ' : ''}
                        {STATUS_LABEL[b.status]}
                      </span>
                    </span>
                  </button>
                  {b.status === 'confirmed' && started ? (
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className={btn.link}
                        onClick={() =>
                          void act(() => actions.complete(b.booking_id), 'Marked completed')
                        }
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className={btn.link}
                        onClick={() =>
                          void act(() => actions.noShow(b.booking_id), 'Marked no-show')
                        }
                      >
                        No-show
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {open ? (
        <BookingDrawer
          bookingId={open}
          businessId={business.id}
          role={role}
          staffOptions={(staff ?? [])
            .filter((s) => s.status === 'active')
            .map((s) => ({ id: s.id, display_name: s.display_name }))}
          onClose={() => setOpen(null)}
          onChanged={(msg) => {
            push({ text: msg });
            void reload();
          }}
        />
      ) : null}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line-200 bg-surface-0 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
