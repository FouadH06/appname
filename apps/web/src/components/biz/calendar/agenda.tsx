'use client';

import { SOURCE_ICON, STATUS_LABEL, type BookingCard } from '@/lib/biz/bookings';
import { useNow } from '@/lib/biz/use-now';
import {
  TIME_OFF_LABEL,
  overlapsDay,
  timeLabel,
  type CalStaff,
  type DayFrame,
} from '@/lib/biz/calendar';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Agenda: one chronological list for the staff in scope (default on phones, Phase 2 B3). */
export function Agenda({
  frame,
  staff,
  items,
  onOpen,
  onGap,
}: {
  frame: DayFrame;
  staff: CalStaff[];
  items: BookingCard[];
  onOpen: (b: BookingCard) => void;
  onGap?: () => void;
}) {
  const now = useNow();
  const rows = items
    .filter((i) => overlapsDay(frame, i.starts_at, i.ends_at))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  const off = staff.flatMap((s) =>
    s.time_off.filter((t) => overlapsDay(frame, t.start, t.end)).map((t) => ({ s, t })),
  );
  const nextId = rows.find((r) => Date.parse(r.ends_at) > now && r.status !== 'cancelled')?.item_id;

  return (
    <div className="flex flex-col gap-2 p-3 md:p-4" data-testid="agenda">
      {off.map(({ s, t }) => (
        <div key={t.id} className="rounded-control bg-surface-100 px-3 py-2 text-xs text-ink-700">
          {s.display_name}: {TIME_OFF_LABEL[t.kind]} {timeLabel(t.start)}–{timeLabel(t.end)}
        </div>
      ))}
      {!rows.length ? (
        <div className="rounded-card border border-line-200 bg-surface-0 p-6 text-center text-sm text-ink-500">
          No appointments.{' '}
          {onGap ? (
            <button type="button" className="font-medium text-accent-600" onClick={onGap}>
              Add one
            </button>
          ) : null}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {rows.map((b) => (
          <li key={b.item_id}>
            <button
              type="button"
              data-testid="appt"
              data-booking-id={b.booking_id}
              data-status={b.status}
              onClick={() => onOpen(b)}
              className={`flex w-full items-center gap-3 rounded-card border bg-surface-0 p-3 text-start ${
                b.item_id === nextId ? 'border-accent-600' : 'border-line-200'
              } ${b.status === 'cancelled' ? 'opacity-60' : ''}`}
            >
              <span className="w-16 shrink-0 text-sm font-semibold">{timeLabel(b.starts_at)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1 truncate font-medium">
                  {b.requested ? <span className="text-star-500">★</span> : null}
                  {b.customer?.name ?? 'Walk-in'}
                  {b.customer?.is_new ? (
                    <span className="rounded bg-info-600 px-1 text-[10px] text-white">New</span>
                  ) : null}
                  {b.internal_note || b.customer?.pinned_note ? <span>📝</span> : null}
                </span>
                <span className="truncate text-xs text-ink-500">
                  {b.service_name} · {b.duration_min} min · {STATUS_LABEL[b.status]}{' '}
                  {SOURCE_ICON[b.source] ?? ''}
                </span>
              </span>
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-100 text-xs font-semibold"
                title={b.staff_name}
              >
                {initials(b.staff_name)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
