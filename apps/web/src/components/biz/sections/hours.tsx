'use client';

import { useState } from 'react';
import type { Tables } from '@app/db';
import { useBiz } from '@/lib/biz/context';
import { beirutToday, loadLocationHours, saveLocationHours } from '@/lib/biz/data';
import { beirutToUtc, fmtBeirut } from '@/lib/biz/schedule';
import { weekErrors, type WeekHours } from '@/lib/biz/time';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { HoursGrid } from '../hours-grid';
import { Field, Notice, Section, btn, codeOf, input } from '../ui';

export function HoursSection({ onSaved }: { onSaved?: () => void }) {
  const { business, location } = useBiz();
  const { data } = useLoad(
    () => (location ? loadLocationHours(location.id) : Promise.resolve(null)),
    [location?.id],
  );
  if (!location || !data) return <p className="text-sm text-ink-500">Loading…</p>;
  return (
    <HoursForm
      key={JSON.stringify(data)}
      businessId={business.id}
      locationId={location.id}
      initial={data}
      onSaved={onSaved}
    />
  );
}

function HoursForm({
  businessId,
  locationId,
  initial,
  onSaved,
}: {
  businessId: string;
  locationId: string;
  initial: WeekHours;
  onSaved?: () => void;
}) {
  const [week, setWeek] = useState(initial);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = !Object.values(week).some((d) => d.length);
  return (
    <Section
      title="Opening hours"
      description="Split shifts are fine (e.g. closed for lunch). Staff hours stay inside these."
    >
      <HoursGrid value={week} onChange={setWeek} />
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <button
        type="button"
        className={btn.primary + ' self-start'}
        disabled={busy || empty || Object.keys(weekErrors(week)).length > 0}
        onClick={() =>
          void (async () => {
            setBusy(true);
            setMsg(null);
            try {
              await saveLocationHours(businessId, locationId, week);
              setMsg({ tone: 'success', text: 'Saved' });
              onSaved?.();
            } catch (e) {
              setMsg({ tone: 'danger', text: describeError(codeOf(e)) });
            } finally {
              setBusy(false);
            }
          })()
        }
      >
        Save hours
      </button>
    </Section>
  );
}

type Closure = Tables<'location_closures'>;
interface Affected {
  id: string;
  ref: string;
  starts_at: string;
}

/** Closures/holidays with the "cancel affected bookings?" flow (Phase 2 B12). */
export function ClosuresSection() {
  const { business, location } = useBiz();
  const today = beirutToday();
  const { data, reload } = useLoad(
    async () =>
      location
        ? (((
            await supabase()
              .from('location_closures')
              .select('*')
              .eq('location_id', location.id)
              .order('period')
          ).data ?? []) as Closure[])
        : [],
    [location?.id],
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!location) return null;

  const upcoming = (data ?? []).filter(
    (c) => String(c.period).slice(1, 11) >= today || String(c.period).slice(12, 22) > today,
  );

  const check = async () => {
    setMsg(null);
    const { data: rows, error } = await supabase()
      .from('bookings')
      .select('id, ref, starts_at')
      .eq('location_id', location.id)
      .in('status', ['pending', 'confirmed'])
      .gte('starts_at', beirutToUtc(from, 0))
      .lt('starts_at', beirutToUtc(to, 1440))
      .order('starts_at');
    if (error) return setMsg({ tone: 'danger', text: describeError(codeOf(error)) });
    if (rows?.length) setAffected(rows);
    else await add(false, []);
  };

  const add = async (cancel: boolean, list: Affected[]) => {
    setBusy(true);
    try {
      const { data: s } = await supabase().auth.getSession();
      const { error } = await supabase()
        .from('location_closures')
        .insert({
          location_id: location.id,
          business_id: business.id,
          period: `[${from},${to}]`,
          label: label.trim() || null,
          created_by: s.session?.user.id,
        });
      if (error) throw error;
      if (cancel) {
        for (const b of list) {
          const r = await supabase().rpc('biz_cancel_booking', {
            p_booking_id: b.id,
            p_reason: label.trim() || 'Closed',
            p_notify: true,
          });
          if (r.error) throw r.error;
        }
      }
      setAffected(null);
      setFrom('');
      setTo('');
      setLabel('');
      setMsg({
        tone: 'success',
        text: cancel
          ? 'Closure added; bookings cancelled and customers notified.'
          : 'Closure added',
      });
      await reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: describeError(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Closures & holidays" description="Nobody can be booked on these dates.">
      <ul className="text-sm">
        {upcoming.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-1">
            <span>
              {String(c.period)
                .replace(/[[\])(]/g, '')
                .replace(',', ' → ')}{' '}
              {c.label ? `· ${c.label}` : ''}
            </span>
            <button
              type="button"
              className={btn.link}
              disabled={busy}
              onClick={() =>
                void supabase()
                  .from('location_closures')
                  .delete()
                  .eq('id', c.id)
                  .then(() => reload())
              }
            >
              Remove
            </button>
          </li>
        ))}
        {upcoming.length === 0 ? <li className="text-ink-500">No upcoming closures.</li> : null}
      </ul>
      {affected ? (
        <Notice tone="warning">
          <p className="font-medium">{affected.length} booking(s) fall on these dates:</p>
          <ul className="my-2">
            {affected.map((b) => (
              <li key={b.id}>
                {fmtBeirut(b.starts_at)} · {b.ref}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn.danger}
              disabled={busy}
              onClick={() => void add(true, affected)}
            >
              Close and cancel them (customers notified)
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => void add(false, [])}
            >
              Close but keep the bookings
            </button>
            <button type="button" className={btn.link} onClick={() => setAffected(null)}>
              Back
            </button>
          </div>
        </Notice>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From">
            <input
              className={input}
              type="date"
              min={today}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To (inclusive)">
            <input
              className={input}
              type="date"
              min={from || today}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Label (optional)">
            <input
              className={input}
              value={label}
              placeholder="Eid holiday"
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy || !from || !to || to < from}
            onClick={() => void check()}
          >
            Add closure
          </button>
        </div>
      )}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Section>
  );
}
