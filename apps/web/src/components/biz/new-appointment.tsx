'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Json } from '@app/db';
import { priceLabel, type Service } from '@/lib/biz/data';
import { parseTime, reliabilityHint, timeLabel, walkInStart } from '@/lib/biz/calendar';
import type { Role } from '@/lib/biz/context';
import { beirutParts, beirutToUtc } from '@/lib/biz/schedule';
import { toHHMM } from '@/lib/biz/time';
import { clockMs } from '@/lib/biz/timing';
import { useLoad } from '@/lib/biz/use-load';
import { useNow } from '@/lib/biz/use-now';
import { supabase } from '@/lib/supabase';
import { bookingError } from './booking-drawer';
import { Drawer } from './overlay';
import { Field, Notice, Toggle, btn, input } from './ui';

export interface FoundCustomer {
  id: string;
  display_name: string;
  phone_e164: string | null;
  visit_count: number;
  last_visit_at: string | null;
  preferred_staff_id: string | null;
  preferred_staff_name: string | null;
  favorite_service_id: string | null;
  reliability_label: string;
  is_blocked_online: boolean;
}

type CustomerChoice =
  | { kind: 'none' }
  | { kind: 'existing'; c: FoundCustomer }
  | { kind: 'new'; phone: string }
  | { kind: 'walkin' };

export interface Prefill {
  date: string;
  minutes?: number;
  staffId?: string | null;
  customer?: FoundCustomer | null;
}

export type CreationFlow = 'slot' | 'button' | 'walk_in' | 'keyboard' | 'customer_page';

export interface SavedBooking {
  bookingId: string;
  summary: string;
  endsAt: string;
}

const digitsOf = (q: string) => q.replace(/[^\d]/g, '');
const looksLikePhone = (q: string) => /^[+\d\s()-]+$/.test(q.trim()) && digitsOf(q).length >= 7;
const phoneDisplay = (q: string) => {
  let d = digitsOf(q);
  if (d.startsWith('961')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return `+961 ${d}`;
};

/**
 * B4 Appointment creation — Customer → Service → Staff → Time → Save, in conversation order.
 * Speed targets: existing customer ≤ 4 interactions from a slot click, new customer ≤ 6.
 * Enter in the customer field picks the first match; Enter anywhere else saves.
 */
export function NewAppointment({
  businessId,
  locationId,
  role,
  myStaffId,
  staff,
  services,
  prefill,
  walkIn,
  flow,
  onClose,
  onSaved,
}: {
  businessId: string;
  locationId: string;
  role: Role;
  myStaffId: string | null;
  staff: { id: string; display_name: string }[];
  services: Service[];
  prefill: Prefill;
  walkIn: boolean;
  /** How the drawer was opened (Gate B timing; no customer data is recorded) */
  flow: CreationFlow;
  onClose: () => void;
  onSaved: (b: SavedBooking, addAnother: boolean) => void;
}) {
  const desk = role !== 'staff';
  const now = useNow();
  const active = services.filter((s) => s.status === 'active');
  const { data: usage } = useLoad(async () => {
    const { data } = await supabase().rpc('biz_service_usage', { p_business_id: businessId });
    return data ?? [];
  }, [businessId]);
  const chips = useMemo(() => {
    const rank = new Map((usage ?? []).map((u, i) => [u.service_id, i]));
    return [...active]
      .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
      .slice(0, 6);
  }, [active, usage]);

  const start0 = walkIn ? walkInStart() : { date: prefill.date, minutes: prefill.minutes };
  const [customer, setCustomer] = useState<CustomerChoice>(
    prefill.customer ? { kind: 'existing', c: prefill.customer } : { kind: 'none' },
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoundCustomer[]>([]);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [serviceId, setServiceId] = useState<string>(
    prefill.customer?.favorite_service_id ?? chips[0]?.id ?? active[0]?.id ?? '',
  );
  const [staffId, setStaffId] = useState<string>(
    role === 'staff' ? (myStaffId ?? '') : (prefill.staffId ?? ''),
  );
  const [date, setDate] = useState(start0.date);
  const [time, setTime] = useState(start0.minutes === undefined ? '' : toHHMM(start0.minutes));
  const [adjust, setAdjust] = useState(false);
  const [duration, setDuration] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [notifyOff, setNotifyOff] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  const [outside, setOutside] = useState(false);
  const [busy, setBusy] = useState(false);
  // Gate B: drawer opened → saved, on a monotonic clock (reset for "Save & add another")
  const [timing, setTiming] = useState(() => ({ start: clockMs(), flow: flow as string }));
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  // the top chip becomes the default once usage arrives (no customer favorite yet)
  const svc = active.find((s) => s.id === serviceId) ?? chips[0] ?? active[0];
  const svcStaff = staff.filter((s) => svc?.staff_ids.includes(s.id));

  // customer lookup (desk roles; staff enter phone + name)
  useEffect(() => {
    if (!desk || customer.kind !== 'none' || !query.trim()) return;
    const q = query;
    const t = window.setTimeout(() => {
      void supabase()
        .rpc('biz_find_customers', { p_business_id: businessId, p_q: q, p_limit: 6 })
        .then(({ data }) => setResults((data as FoundCustomer[] | null) ?? []));
    }, 120);
    return () => window.clearTimeout(t);
  }, [businessId, customer.kind, desk, query]);
  const shown = query.trim() && customer.kind === 'none' ? results : [];

  // free times for the chips (and busy marks on the staff picker)
  const { data: slots } = useLoad(async () => {
    if (!svc || !date) return [];
    const { data } = await supabase().rpc('biz_get_available_slots', {
      p_location_id: locationId,
      p_service_id: svc.id,
      p_staff_id: staffId || undefined,
      p_date: date,
    });
    return data ?? [];
  }, [locationId, svc?.id, staffId, date]);
  const minutes = parseTime(time);
  const startIso = minutes === null || !date ? null : beirutToUtc(date, minutes);
  const nextFree = (slots ?? [])
    .filter(
      (s) =>
        Date.parse(s.slot_start) >=
        Math.max(now - 5 * 60_000, startIso && error ? Date.parse(startIso) : 0),
    )
    .slice(0, 6);
  const freeAtStart = startIso
    ? (slots ?? []).find(
        (s) => s.slot_start === startIso || Date.parse(s.slot_start) === Date.parse(startIso),
      )
    : undefined;
  const durationMin = Number(duration) || svc?.duration_min || 30;
  const endsInPast = startIso ? Date.parse(startIso) + durationMin * 60_000 <= now : false;
  const markDone = done ?? endsInPast;

  const pickExisting = (c: FoundCustomer) => {
    setCustomer({ kind: 'existing', c });
    if (c.favorite_service_id && active.some((s) => s.id === c.favorite_service_id))
      setServiceId(c.favorite_service_id);
    setResults([]);
    // keyboard flow: next stop is the time (Enter there saves)
    window.setTimeout(() => timeRef.current?.focus(), 0);
  };
  const pickNew = () => {
    setCustomer({ kind: 'new', phone: looksLikePhone(query) ? query : '' });
    if (!looksLikePhone(query)) setFirst(query.trim());
    setResults([]);
    window.setTimeout(() => firstRef.current?.focus(), 0);
  };
  const resetCustomer = () => {
    setCustomer({ kind: 'none' });
    setQuery('');
    window.setTimeout(() => customerRef.current?.focus(), 0);
  };

  const custName =
    customer.kind === 'existing'
      ? customer.c.display_name.split(' ')[0]
      : customer.kind === 'new'
        ? first.trim() || 'New customer'
        : customer.kind === 'walkin' || walkIn
          ? 'Walk-in'
          : '…';
  const staffName = staffId
    ? staff.find((s) => s.id === staffId)?.display_name.split(' ')[0]
    : 'Any';
  const summary = `${custName} · ${svc?.name ?? '…'} · ${staffName} · ${minutes === null ? '…' : timeLabel(startIso!)}`;
  const hasPhone = customer.kind === 'existing' ? !!customer.c.phone_e164 : customer.kind === 'new';

  const save = async (addAnother: boolean) => {
    setError(null);
    if (!svc) return setError({ code: 'X', text: 'Pick a service.' });
    if (!startIso) return setError({ code: 'X', text: 'Check the time (e.g. 16:30).' });
    let p_customer: Json | null = null;
    if (customer.kind === 'existing') p_customer = { business_customer_id: customer.c.id };
    else if (customer.kind === 'new') {
      const phone = customer.phone || (looksLikePhone(query) ? query : '');
      if (!phone) return setError({ code: 'X', text: 'Enter the customer’s phone number.' });
      if (!first.trim()) return setError({ code: 'X', text: 'Enter the customer’s first name.' });
      p_customer = { phone, name: [first.trim(), last.trim()].filter(Boolean).join(' ') };
    } else if (customer.kind === 'none' && !walkIn) {
      if (query.trim() && !desk)
        return setError({ code: 'X', text: 'Enter a phone number and name, or choose Walk-in.' });
      return setError({ code: 'X', text: 'Pick a customer, add a new one, or choose Walk-in.' });
    }
    const asWalkIn = walkIn || customer.kind === 'walkin';
    setBusy(true);
    const { data, error: err } = await supabase().rpc('create_manual_booking', {
      p_location_id: locationId,
      p_customer,
      p_service_id: svc.id,
      p_staff_id: staffId || undefined,
      p_start: startIso,
      p_duration_override: adjust && Number(duration) ? Number(duration) : undefined,
      p_price_override: adjust && price.trim() ? { type: 'fixed', min: Number(price) } : undefined,
      p_internal_note: note.trim() || undefined,
      p_notify: hasPhone && !notifyOff,
      p_allow_outside_hours: outside,
      p_as_walk_in: asWalkIn,
      p_mark_completed: markDone && endsInPast,
    });
    setBusy(false);
    if (err || !data) {
      const name = staffId ? staff.find((s) => s.id === staffId)?.display_name : undefined;
      return setError(bookingError(err, name));
    }
    const b = data as { id: string; ends_at: string };
    void supabase()
      .rpc('biz_log_booking_timing', {
        p_booking_id: b.id,
        p_duration_ms: Math.round(clockMs() - timing.start),
        p_customer_kind:
          customer.kind === 'existing' ? 'existing' : customer.kind === 'new' ? 'new' : 'walk_in',
        p_flow: timing.flow,
      })
      .then(() => undefined);
    setTiming({ start: clockMs(), flow: 'add_another' });
    onSaved({ bookingId: b.id, summary, endsAt: b.ends_at }, addAnother);
    if (addAnother) {
      const p = beirutParts(b.ends_at);
      setDate(p.date);
      setTime(toHHMM(p.minutes));
      setNote('');
      setOutside(false);
    }
  };

  return (
    <Drawer
      title={walkIn ? 'Walk-in' : 'New appointment'}
      onClose={onClose}
      testId="new-appointment"
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            form="new-appointment-form"
            className={btn.primary + ' w-full'}
            disabled={busy}
            data-testid="save-appointment"
          >
            Save · {summary}
          </button>
          {desk ? (
            <button
              type="button"
              className={btn.link + ' self-center'}
              disabled={busy}
              onClick={() => void save(true)}
            >
              Save &amp; add another
            </button>
          ) : null}
        </div>
      }
    >
      <form
        id="new-appointment-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {/* 1 · Customer */}
        {customer.kind === 'existing' ? (
          <div
            className="flex flex-col gap-1 rounded-control bg-surface-50 p-3 text-sm"
            data-testid="picked-customer"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{customer.c.display_name}</span>
              <button type="button" className={btn.link} onClick={resetCustomer}>
                Change
              </button>
            </div>
            <span className="text-ink-500">
              {customer.c.phone_e164 ?? 'No phone'} · {customer.c.visit_count} visit
              {customer.c.visit_count === 1 ? '' : 's'}
              {reliabilityHint(customer.c.reliability_label)
                ? ` · ${reliabilityHint(customer.c.reliability_label)}`
                : ''}
            </span>
            {customer.c.is_blocked_online ? (
              <Notice tone="warning">
                Blocked from online booking — manual booking is allowed.
              </Notice>
            ) : null}
            {customer.c.preferred_staff_id &&
            customer.c.preferred_staff_id !== staffId &&
            role !== 'staff' ? (
              <button
                type="button"
                className={btn.link + ' self-start'}
                onClick={() => setStaffId(customer.c.preferred_staff_id!)}
              >
                Usually with {customer.c.preferred_staff_name}
              </button>
            ) : null}
          </div>
        ) : customer.kind === 'walkin' ? (
          <div className="flex items-center justify-between rounded-control bg-surface-50 p-3 text-sm">
            <span className="font-semibold">Walk-in (no details)</span>
            <button type="button" className={btn.link} onClick={resetCustomer}>
              Add details
            </button>
          </div>
        ) : customer.kind === 'new' ? (
          <div
            className="flex flex-col gap-3 rounded-control bg-surface-50 p-3"
            data-testid="new-customer"
          >
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">New customer</span>
              <button type="button" className={btn.link} onClick={resetCustomer}>
                Change
              </button>
            </div>
            <Field label="Phone">
              <input
                className={input}
                inputMode="tel"
                value={customer.phone}
                onChange={(e) => setCustomer({ kind: 'new', phone: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <input
                  ref={firstRef}
                  className={input}
                  value={first}
                  maxLength={40}
                  onChange={(e) => setFirst(e.target.value)}
                />
              </Field>
              <Field label="Last name (optional)">
                <input
                  className={input}
                  value={last}
                  maxLength={40}
                  onChange={(e) => setLast(e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Field label={desk ? 'Phone or name' : 'Customer phone'}>
              <input
                ref={customerRef}
                className={input}
                value={query}
                autoFocus={!walkIn}
                autoComplete="off"
                inputMode={desk ? 'text' : 'tel'}
                placeholder={desk ? '70 123 456 or Moe' : '70 123 456'}
                role="combobox"
                aria-expanded={shown.length > 0}
                aria-controls="customer-options"
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (!e.target.value.trim()) setResults([]);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  if (shown[0]) pickExisting(shown[0]);
                  else if (query.trim()) pickNew();
                }}
              />
            </Field>
            {query.trim() ? (
              <ul
                id="customer-options"
                role="listbox"
                className="flex flex-col rounded-control border border-line-200"
                data-testid="customer-options"
              >
                {shown.map((c) => (
                  <li key={c.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="flex w-full flex-col items-start px-3 py-2 text-start text-sm hover:bg-surface-50"
                      onClick={() => pickExisting(c)}
                    >
                      <span className="font-medium">{c.display_name}</span>
                      <span className="text-xs text-ink-500">
                        {c.phone_e164 ?? 'No phone'} · {c.visit_count} visits
                        {c.preferred_staff_name ? ` · usually with ${c.preferred_staff_name}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-start text-sm font-medium text-accent-600 hover:bg-surface-50"
                    onClick={pickNew}
                  >
                    New customer: {looksLikePhone(query) ? phoneDisplay(query) : query.trim()}
                  </button>
                </li>
              </ul>
            ) : null}
            <button
              type="button"
              className={btn.link + ' self-start'}
              onClick={() => setCustomer({ kind: 'walkin' })}
            >
              Skip → Walk-in (no details)
            </button>
          </div>
        )}

        {/* 2 · Service */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Service</span>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Service"
            data-testid="service-chips"
          >
            {chips.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={svc?.id === s.id}
                className={`rounded-full border px-3 py-1.5 text-sm ${svc?.id === s.id ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
                onClick={() => setServiceId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>
          {active.length > chips.length ? (
            <select
              aria-label="All services"
              className={input}
              value={svc?.id ?? ''}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : null}
          {svc ? (
            <span className="text-xs text-ink-500">
              {svc.duration_min} min · {priceLabel(svc)}{' '}
              <button
                type="button"
                className={btn.link + ' text-xs'}
                onClick={() => setAdjust((a) => !a)}
              >
                {adjust ? 'Use standard' : 'Adjust for this booking'}
              </button>
            </span>
          ) : (
            <Notice tone="warning">Add a service first (Services).</Notice>
          )}
          {adjust ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duration (min)">
                <input
                  className={input}
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder={String(svc?.duration_min ?? '')}
                />
              </Field>
              <Field label="Price ($)">
                <input
                  className={input}
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </div>

        {/* 3 · Staff */}
        {role !== 'staff' ? (
          <Field label="Staff">
            <select className={input} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">Any available</option>
              {svcStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                  {!staffId && freeAtStart && !freeAtStart.staff_ids.includes(s.id)
                    ? ' (busy)'
                    : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        {/* 4 · Date & time */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              className={input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Time">
            <input
              ref={timeRef}
              className={input}
              value={time}
              placeholder="16:30"
              onChange={(e) => setTime(e.target.value)}
            />
          </Field>
        </div>
        {nextFree.length ? (
          <div className="flex flex-wrap gap-2" data-testid="time-chips">
            <span className="w-full text-xs text-ink-500">
              {error ? 'Next free' : 'Free times'}
            </span>
            {nextFree.map((s) => (
              <button
                key={s.slot_start}
                type="button"
                className="rounded-full border border-line-200 px-3 py-1 text-sm hover:border-accent-600"
                onClick={() => {
                  const p = beirutParts(s.slot_start);
                  setDate(p.date);
                  setTime(toHHMM(p.minutes));
                  setError(null);
                }}
              >
                {timeLabel(s.slot_start)}
              </button>
            ))}
          </div>
        ) : null}
        {endsInPast ? (
          <Toggle label="Already done — mark as completed" checked={markDone} onChange={setDone} />
        ) : null}

        {/* 5 · Note, 6 · Notify */}
        <Field label="Note (internal, optional)">
          <input
            className={input}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {hasPhone ? (
          <Toggle
            label="Send confirmation on WhatsApp"
            checked={!notifyOff}
            onChange={(v) => setNotifyOff(!v)}
          />
        ) : null}

        {error ? (
          <div className="flex flex-col gap-2" data-testid="appointment-error">
            <Notice tone="danger">{error.text}</Notice>
            {error.code === 'OUTSIDE_HOURS' && desk ? (
              <button
                type="button"
                className={btn.secondary + ' self-start'}
                onClick={() => {
                  setOutside(true);
                  setError(null);
                }}
              >
                Book outside hours anyway
              </button>
            ) : null}
          </div>
        ) : null}
        {outside ? (
          <Notice tone="warning">
            This booking is outside working hours (allowed for manual bookings).
          </Notice>
        ) : null}
      </form>
    </Drawer>
  );
}
