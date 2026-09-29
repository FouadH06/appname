'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { beirutParts } from '@/lib/biz/schedule';
import { useNow } from '@/lib/biz/use-now';
import { describeError } from '@/lib/copy';
import {
  dateTimeText,
  dayText,
  durationText,
  mapsLink,
  priceText,
  relativeDay,
  timeText,
  waLink,
} from '@/lib/public/format';
import type { MyBooking, MyBookingDetail } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';

// C12 cards and C13 detail pieces (customer side).

export const STATUS: Record<MyBooking['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for confirmation', tone: 'bg-warning-600' },
  confirmed: { label: 'Confirmed', tone: 'bg-success-600' },
  completed: { label: 'Completed', tone: 'bg-ink-500' },
  cancelled: { label: 'Cancelled', tone: 'bg-ink-500' },
  no_show: { label: 'Missed', tone: 'bg-danger-600' },
};

const EVENT: Record<string, string> = {
  confirmed: 'Booked',
  requested: 'Request sent',
  accepted: 'Confirmed by the business',
  declined: 'Declined by the business',
  expired: 'Request expired',
  rescheduled: 'Moved',
  staff_changed: 'Staff changed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show_marked: 'Marked as missed',
  no_show_contested: 'You contested the no-show',
  no_show_resolved: 'Contest resolved',
  customer_confirmed: 'You confirmed you’re coming',
  claimed: 'Added to your account',
};

const beirutToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(new Date());

export function BookingCard({ b }: { b: MyBooking }) {
  const s = STATUS[b.status];
  return (
    <Link
      href={`/bookings/${b.id}`}
      className="flex gap-3 rounded-card border border-line-200 bg-surface-0 p-3"
      data-testid="my-booking"
    >
      <span className="flex w-14 shrink-0 flex-col items-center justify-center rounded-control bg-surface-100 py-2 text-center">
        <span className="text-xs">
          {new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'Asia/Beirut' }).format(
            new Date(b.starts_at),
          )}
        </span>
        <span className="text-lg font-semibold">
          {beirutParts(b.starts_at).date.slice(8).replace(/^0/, '')}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold" dir="auto">
          {b.business.name}
        </span>
        <span className="block text-sm text-ink-700">
          {b.service_name} · with {b.staff_first_name}
        </span>
        <span className="block text-sm text-ink-500">
          {relativeDay(beirutParts(b.starts_at).date, beirutToday())} · {timeText(b.starts_at)}
        </span>
        <span className="mt-1 flex flex-wrap gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 text-white ${s.tone}`}>{s.label}</span>
          {b.booked_by_business ? (
            <span className="text-ink-500">Booked by {b.business.name}</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

function icsFor(b: MyBooking) {
  const fmt = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const where = [b.location.address_line, b.location.area].filter(Boolean).join(', ');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//APP_NAME//booking//EN',
    'BEGIN:VEVENT',
    `UID:${b.id}@app`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(b.starts_at)}`,
    `DTEND:${fmt(b.ends_at)}`,
    `SUMMARY:${b.service_name} at ${b.business.name}`,
    `LOCATION:${where}`,
    `DESCRIPTION:Booking ${b.ref}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
}

function googleCalendar(b: MyBooking) {
  const fmt = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${b.service_name} at ${b.business.name}`,
    dates: `${fmt(b.starts_at)}/${fmt(b.ends_at)}`,
    location: [b.location.address_line, b.location.area].filter(Boolean).join(', '),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

const maskPhone = (digits: string | undefined) => {
  if (!digits) return null;
  const d = digits.replace(/\D/g, '');
  return `+${d.slice(0, 3)} ${d.slice(3, 5)} ••• ${d.slice(-3)}`;
};

const btn =
  'flex h-11 items-center justify-center rounded-control border border-line-200 bg-surface-0 px-4 text-sm font-medium';
const primary =
  'flex h-12 items-center justify-center rounded-control bg-accent-600 px-4 font-semibold text-white disabled:opacity-50';
const danger =
  'flex h-11 items-center justify-center rounded-control border border-danger-600 px-4 text-sm font-medium text-danger-600 disabled:opacity-50';

export function BookingDetail({
  id,
  isNew,
  phone,
}: {
  id: string;
  isNew: boolean;
  phone: string | undefined;
}) {
  const now = useNow();
  const [b, setB] = useState<MyBookingDetail | null | 'forbidden'>(null);
  const [panel, setPanel] = useState<'none' | 'cancel' | 'reschedule' | 'contest'>('none');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase().rpc('get_my_booking', { p_booking_id: id });
    return err ? ('forbidden' as const) : (data as unknown as MyBookingDetail);
  }, [id]);
  useEffect(() => {
    let alive = true;
    void load().then((r) => alive && setB(r));
    return () => {
      alive = false;
    };
  }, [load]);
  const refresh = async (text: string) => {
    setPanel('none');
    setMsg(text);
    setB(await load());
  };

  if (b === null) return <p className="text-sm text-ink-500">Loading…</p>;
  if (b === 'forbidden') {
    return (
      <p className="text-sm text-ink-700">
        This booking isn’t on this account. Sign in with the number you booked with.
      </p>
    );
  }
  const s = STATUS[b.status];
  const wa = waLink(b.location.whatsapp, `Hi ${b.business.name}, about my booking ${b.ref}`);
  const withinWindow = Date.parse(b.starts_at) - now < b.cancellation_window_minutes * 60_000;

  return (
    <div className="flex flex-col gap-4">
      {isNew ? (
        <section
          className="flex flex-col items-center gap-1 text-center"
          data-testid="booking-success"
        >
          <span className="grid size-14 place-items-center rounded-full bg-success-600 text-2xl text-white">
            ✓
          </span>
          <h1 className="text-2xl font-semibold">
            {b.status === 'pending' ? 'Request sent' : 'You’re booked'}
          </h1>
          {b.status === 'pending' ? (
            <p className="text-sm text-ink-700">
              We’ll message you when {b.business.name} confirms. If they don’t reply in time, the
              request expires automatically.
            </p>
          ) : null}
          {maskPhone(phone) ? (
            <p className="text-sm text-ink-500">Confirmation sent to WhatsApp {maskPhone(phone)}</p>
          ) : null}
        </section>
      ) : null}

      {b.staff_changed && b.status === 'confirmed' ? (
        <p className="rounded-control bg-info-600 px-3 py-2 text-sm text-white">
          Your appointment is now with {b.staff_first_name} (changed by {b.business.name}).
        </p>
      ) : null}
      {msg ? (
        <p className="rounded-control bg-surface-100 px-3 py-2 text-sm" role="status">
          {msg}
        </p>
      ) : null}

      <section
        className="flex flex-col gap-2 rounded-card border border-line-200 bg-surface-0 p-4"
        data-testid="booking-detail"
      >
        <span
          className={`self-start rounded px-2 py-0.5 text-xs text-white ${s.tone}`}
          data-testid="booking-status"
        >
          {s.label}
        </span>
        <p className="text-lg font-semibold">{dateTimeText(b.starts_at)}</p>
        <p>
          {b.service_name} · with {b.staff_first_name} · {durationText(b.duration_min)}
        </p>
        <p className="text-sm text-ink-700">{priceText(b)} · Pay at the venue</p>
        <Link href={`/${b.business.slug}`} className="font-medium" dir="auto">
          {b.business.name}
        </Link>
        <p className="text-sm text-ink-700">
          {[b.location.address_line, b.location.area].filter(Boolean).join(', ')}
          {b.location.landmark ? ` · ${b.location.landmark}` : ''}
        </p>
        {b.customer_note ? (
          <p className="text-sm text-ink-500">Your note: {b.customer_note}</p>
        ) : null}
        {b.cancel_reason ? <p className="text-sm text-ink-700">Reason: {b.cancel_reason}</p> : null}
        <p className="text-xs text-ink-500">Ref {b.ref}</p>
      </section>

      {/* actions by state */}
      <div className="flex flex-col gap-2" data-testid="booking-actions">
        {b.status === 'confirmed' || b.status === 'pending' ? (
          <div className="grid grid-cols-2 gap-2">
            <a className={btn} href={googleCalendar(b)} target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            <a className={btn} href={icsFor(b)} download={`booking-${b.ref}.ics`}>
              Add to calendar
            </a>
            <a
              className={btn}
              href={mapsLink(b.location.lat, b.location.lng)}
              target="_blank"
              rel="noreferrer"
            >
              Directions
            </a>
            {wa ? (
              <a className={btn} href={wa}>
                WhatsApp
              </a>
            ) : b.location.phone ? (
              <a className={btn} href={`tel:${b.location.phone}`}>
                Call
              </a>
            ) : null}
          </div>
        ) : null}
        {b.status === 'confirmed' && b.can_reschedule && b.staff_id ? (
          <button type="button" className={btn} onClick={() => setPanel('reschedule')}>
            Reschedule
          </button>
        ) : null}
        {b.status === 'confirmed' && b.can_reschedule && !b.staff_id ? (
          <p className="text-sm text-ink-700">
            To change the time, contact {b.business.name}
            {wa ? ' on WhatsApp' : ''}.
          </p>
        ) : null}
        {b.status === 'completed' ? (
          <>
            {b.staff_id ? (
              <Link
                className={primary}
                href={`/${b.business.slug}/book?service=${b.service_id}&staff=${b.staff_id}`}
              >
                Book again with {b.staff_first_name}
              </Link>
            ) : null}
            <Link className={btn} href={`/${b.business.slug}/book?service=${b.service_id}`}>
              Book again with anyone
            </Link>
            {/* the review page explains when a visit can't be reviewed (window, already done) */}
            <Link className={btn} href={`/bookings/${b.id}/review`} data-testid="leave-review">
              Leave a review
            </Link>
          </>
        ) : null}
        {b.status === 'cancelled' && b.business.live ? (
          <Link className={primary} href={`/${b.business.slug}`}>
            Book another time
          </Link>
        ) : null}
        {b.can_contest ? (
          <button type="button" className={btn} onClick={() => setPanel('contest')}>
            I was there
          </button>
        ) : null}
        {b.status === 'no_show' && b.no_show_disputed ? (
          <p className="text-sm text-ink-700">Under review by APP_NAME support.</p>
        ) : null}
        {b.can_cancel ? (
          <button
            type="button"
            className={danger}
            onClick={() => setPanel('cancel')}
            data-testid="cancel-booking"
          >
            {b.status === 'pending' ? 'Cancel request' : 'Cancel booking'}
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger-600">
          {error}
        </p>
      ) : null}
      {panel === 'cancel' ? (
        <CancelSheet
          b={b}
          late={withinWindow && b.status === 'confirmed'}
          onClose={() => setPanel('none')}
          onDone={refresh}
          onError={setError}
        />
      ) : null}
      {panel === 'reschedule' ? (
        <RescheduleSheet
          b={b}
          onClose={() => setPanel('none')}
          onDone={refresh}
          onError={setError}
        />
      ) : null}
      {panel === 'contest' ? (
        <ContestSheet b={b} onClose={() => setPanel('none')} onDone={refresh} onError={setError} />
      ) : null}

      <p className="text-xs text-ink-500">
        {b.cancellation_window_minutes > 0
          ? `Free cancellation until ${Math.round(b.cancellation_window_minutes / 60)}h before.`
          : 'Free cancellation until the appointment starts.'}
        {b.messages_failed ? ' We couldn’t reach you on WhatsApp for this booking.' : ''}
      </p>
      {b.timeline.length ? (
        <section>
          <h2 className="mb-2 font-semibold">Activity</h2>
          <ol
            className="flex flex-col gap-1 border-s border-line-200 ps-3 text-sm"
            data-testid="timeline"
          >
            {b.timeline.map((e, i) => (
              <li key={i}>
                {EVENT[e.event] ?? e.event}
                {e.event === 'rescheduled' && e.new_start ? ` to ${dateTimeText(e.new_start)}` : ''}
                <span className="text-xs text-ink-500"> · {dayText(e.created_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-card bg-surface-0 p-5 md:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CancelSheet({
  b,
  late,
  onClose,
  onDone,
  onError,
}: {
  b: MyBooking;
  late: boolean;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      title={b.status === 'pending' ? 'Cancel this request?' : 'Cancel this booking?'}
      onClose={onClose}
    >
      {late ? (
        <p className="mb-3 text-sm text-ink-700" data-testid="late-cancel-warning">
          This is within {Math.round(b.cancellation_window_minutes / 60)} hours of your booking.
          Late cancellations may affect your ability to book instantly.
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason (optional)</span>
        <select
          className="h-11 rounded-control border border-line-200 px-3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        >
          <option value="">—</option>
          <option>Plans changed</option>
          <option>Booked another time</option>
          <option>Feeling unwell</option>
          <option>Other</option>
        </select>
      </label>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className={danger}
          disabled={busy}
          data-testid="confirm-cancel"
          onClick={() => {
            setBusy(true);
            onError(null);
            void supabase()
              .rpc('cancel_my_booking', { p_booking_id: b.id, p_reason: reason || undefined })
              .then(async ({ error }) => {
                setBusy(false);
                if (error) return onError(describeError(error.message));
                await onDone('Cancelled. You’ll get a confirmation on WhatsApp.');
              });
          }}
        >
          Yes, cancel
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Keep booking
        </button>
      </div>
    </Sheet>
  );
}

function RescheduleSheet({
  b,
  onClose,
  onDone,
  onError,
}: {
  b: MyBooking;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const today = beirutToday();
  // Same staff member (default) or Any available (assigned by the business rule before confirming)
  const [who, setWho] = useState<'same' | 'any'>('same');
  const staffParam = who === 'same' ? (b.staff_id ?? undefined) : undefined;
  const [days, setDays] = useState<{ who: string; list: string[] } | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<{ key: string; list: string[] } | null>(null);
  const [pick, setPick] = useState<{
    start: string;
    staffId: string | null;
    name: string;
    price: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase()
      .rpc('get_available_days', {
        p_location_id: b.location.id,
        p_service_id: b.service_id,
        p_staff_id: staffParam,
      })
      .then(({ data }) => {
        if (!alive) return;
        const list = ((data ?? []) as string[]).sort();
        setDays({ who, list });
        setDate((d) => (d && list.includes(d) ? d : (list[0] ?? null)));
      });
    return () => {
      alive = false;
    };
  }, [b.location.id, b.service_id, staffParam, who]);
  const slotKey = `${who}|${date}`;
  useEffect(() => {
    if (!date) return;
    let alive = true;
    void supabase()
      .rpc('get_available_slots', {
        p_location_id: b.location.id,
        p_service_id: b.service_id,
        p_staff_id: staffParam,
        p_date_from: date,
        p_date_to: date,
      })
      .then(
        ({ data }) =>
          alive &&
          setSlots({
            key: slotKey,
            list: (data ?? []).map((r) => r.slot_start).filter((s) => s !== b.starts_at),
          }),
      );
    return () => {
      alive = false;
    };
  }, [date, b.location.id, b.service_id, staffParam, b.starts_at, slotKey]);

  const choose = async (start: string) => {
    onError(null);
    if (who === 'same') {
      return setPick({ start, staffId: null, name: b.staff_first_name, price: priceText(b) });
    }
    setBusy(true);
    const { data, error } = await supabase().rpc('preview_reschedule_any', {
      p_booking_id: b.id,
      p_new_start: start,
    });
    setBusy(false);
    const row = data?.[0];
    if (error || !row) return onError(describeError(error?.message ?? 'SLOT_TAKEN'));
    setPick({
      start,
      staffId: row.staff_id,
      name: row.staff_first_name,
      price: priceText({ ...row, currency: b.currency }),
    });
  };

  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    onError(null);
    const { error } = pick.staffId
      ? await supabase().rpc('reschedule_my_booking_any', {
          p_booking_id: b.id,
          p_new_start: pick.start,
          p_staff_id: pick.staffId,
        })
      : await supabase().rpc('reschedule_my_booking', {
          p_booking_id: b.id,
          p_new_start: pick.start,
        });
    setBusy(false);
    if (error) {
      if (error.message === 'STAFF_NOT_FREE' && pick.staffId) {
        // the person we showed was just taken: assign again and show the new name
        onError(`${pick.name} was just booked at ${timeText(pick.start)}.`);
        return void choose(pick.start);
      }
      return onError(describeError(error.message, { staff: pick.name }));
    }
    await onDone(`Moved to ${dateTimeText(pick.start)} with ${pick.name}.`);
  };

  const dayList = days?.who === who ? days.list : null;
  return (
    <Sheet title="Reschedule" onClose={onClose}>
      <div
        className="mb-3 flex rounded-control border border-line-200 p-1"
        role="radiogroup"
        aria-label="Who"
      >
        {(['same', 'any'] as const).map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={who === w}
            className={`h-9 flex-1 rounded-control text-sm font-medium ${who === w ? 'bg-accent-600 text-white' : ''}`}
            onClick={() => {
              setWho(w);
              setPick(null);
            }}
          >
            {w === 'same' ? `With ${b.staff_first_name}` : 'Any available'}
          </button>
        ))}
      </div>
      {pick ? (
        <div className="flex flex-col gap-3" data-testid="reschedule-confirm">
          <p>
            Move to <span className="font-semibold">{dateTimeText(pick.start)}</span> with{' '}
            <span className="font-semibold" data-testid="reschedule-with">
              {pick.name}
            </span>
            ?
          </p>
          <p className="text-sm text-ink-700">{pick.price}</p>
          <button type="button" className={primary} disabled={busy} onClick={() => void confirm()}>
            Confirm new time
          </button>
          <button type="button" className={btn} onClick={() => setPick(null)}>
            Pick another time
          </button>
        </div>
      ) : (
        <>
          {dayList && !dayList.length ? (
            <p className="text-sm">
              {who === 'same' ? `${b.staff_first_name} has` : 'There are'} no free times in the next
              two weeks.
              {who === 'same' ? ' Try Any available.' : ` Contact ${b.business.name} on WhatsApp.`}
            </p>
          ) : null}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {(dayList ?? []).map((d) => (
              <button
                key={d}
                type="button"
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${d === date ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
                onClick={() => setDate(d)}
              >
                {relativeDay(d, today)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2" data-testid="reschedule-slots">
            {slots?.key === slotKey
              ? slots.list.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    className="h-11 rounded-control border border-line-200 text-sm"
                    onClick={() => void choose(s)}
                  >
                    {timeText(s)}
                  </button>
                ))
              : null}
          </div>
        </>
      )}
      <button type="button" className={`${btn} mt-4 w-full`} onClick={onClose}>
        Close
      </button>
    </Sheet>
  );
}

function ContestSheet({
  b,
  onClose,
  onDone,
  onError,
}: {
  b: MyBooking;
  onClose: () => void;
  onDone: (m: string) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="I was there" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-700">
        Tell us what happened. APP_NAME support will review it with {b.business.name}; until then
        this doesn’t count against you.
      </p>
      <textarea
        className="h-28 w-full rounded-control border border-line-200 p-3 text-sm"
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. I arrived at 4:25 and was served by Karim"
      />
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy || text.trim().length < 5}
          onClick={() => {
            setBusy(true);
            onError(null);
            void supabase()
              .rpc('contest_no_show', { p_booking_id: b.id, p_statement: text.trim() })
              .then(async ({ error }) => {
                setBusy(false);
                if (error) return onError(describeError(error.message));
                await onDone('Thanks — we’ll look into it and let you know.');
              });
          }}
        >
          Send
        </button>
        <button type="button" className={btn} onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
