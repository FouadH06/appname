'use client';

import { useState } from 'react';
import { actions, notifyMandatory, type BookingCard } from '@/lib/biz/bookings';
import { fmtBeirut } from '@/lib/biz/schedule';
import { bookingError, ReassignPanel } from './booking-drawer';
import { Notice, Section, btn } from './ui';

/**
 * Affected-booking flow (Phase 2 B9/B12): when a staff member's time goes away (time off, blocked
 * time, new hours, archiving), walk through each of their bookings and give it to a free
 * colleague, or cancel it with a notification. "Keep" leaves it as is.
 */
export function AffectedBookings({
  title,
  bookings,
  onDone,
  reason = 'Staff unavailable',
}: {
  title: string;
  bookings: BookingCard[];
  onDone: (summary: string) => void;
  reason?: string;
}) {
  const [left, setLeft] = useState(bookings);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState({ moved: 0, cancelled: 0 });

  const finish = (next: BookingCard[], h: typeof handled) => {
    setLeft(next);
    setHandled(h);
    setOpen(null);
    if (!next.length) {
      const parts = [
        h.moved ? `${h.moved} reassigned` : '',
        h.cancelled ? `${h.cancelled} cancelled (customers notified)` : '',
      ].filter(Boolean);
      onDone(parts.length ? `Bookings handled: ${parts.join(', ')}` : 'Bookings kept');
    }
  };

  const act = async (
    b: BookingCard,
    fn: () => Promise<void>,
    kind: 'moved' | 'cancelled' | 'kept',
  ) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      finish(
        left.filter((x) => x.item_id !== b.item_id),
        kind === 'kept' ? handled : { ...handled, [kind]: handled[kind] + 1 },
      );
    } catch (e) {
      setError(bookingError(e).text);
    } finally {
      setBusy(false);
    }
  };

  if (!left.length) return null;
  return (
    <Section
      title={title}
      description="Give each booking to a free colleague, cancel it, or keep it."
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <ul className="flex flex-col gap-3" data-testid="affected-bookings">
        {left.map((b) => (
          <li
            key={b.item_id}
            className="flex flex-col gap-2 border-b border-line-200 pb-3 text-sm last:border-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{fmtBeirut(b.starts_at)}</span> · {b.service_name} ·{' '}
                {b.customer?.name ?? 'Walk-in'}
                {notifyMandatory(b) ? (
                  <span className="ms-1 text-xs text-star-500">★ Requested</span>
                ) : null}
              </span>
              <span className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={busy}
                  onClick={() => setOpen(open === b.item_id ? null : b.item_id)}
                >
                  Reassign
                </button>
                <button
                  type="button"
                  className={btn.danger}
                  disabled={busy}
                  onClick={() =>
                    void act(b, () => actions.cancel(b.booking_id, reason, true), 'cancelled')
                  }
                >
                  Cancel &amp; notify
                </button>
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy}
                  onClick={() => void act(b, async () => {}, 'kept')}
                >
                  Keep
                </button>
              </span>
            </div>
            {open === b.item_id ? (
              <ReassignPanel
                b={b}
                busy={busy}
                onCancel={() => setOpen(null)}
                onPick={(staffId, notify) =>
                  act(b, () => actions.reassign(b.item_id, staffId, notify), 'moved')
                }
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
