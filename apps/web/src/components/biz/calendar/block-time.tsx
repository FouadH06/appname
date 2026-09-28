'use client';

import { useState } from 'react';
import { affectedBookings, type BookingCard } from '@/lib/biz/bookings';
import { parseTime, TIME_OFF_LABEL, timeLabel, type CalTimeOff } from '@/lib/biz/calendar';
import { beirutToUtc } from '@/lib/biz/schedule';
import { toHHMM } from '@/lib/biz/time';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { AffectedBookings } from '../affected-bookings';
import { Drawer } from '../overlay';
import { Field, Notice, btn, codeOf, input } from '../ui';

/** "Block time" straight from the grid (break, personal, training) — Phase 2 B3 §4.4. */
export function BlockTimeDrawer({
  staff,
  date,
  minutes,
  desk,
  onClose,
  onSaved,
}: {
  staff: { id: string; display_name: string };
  date: string;
  minutes: number;
  desk: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [day, setDay] = useState(date);
  const [from, setFrom] = useState(toHHMM(minutes));
  const [to, setTo] = useState(toHHMM(Math.min(minutes + 60, 1439)));
  const [kind, setKind] = useState<CalTimeOff['kind']>('personal');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [affected, setAffected] = useState<BookingCard[] | null>(null);

  const save = async () => {
    const a = parseTime(from);
    const b = parseTime(to);
    if (a === null || b === null || b <= a) return setError(describeError('INVALID_RANGE'));
    setBusy(true);
    setError(null);
    const startIso = beirutToUtc(day, a);
    const endIso = beirutToUtc(day, b);
    const { error: err } = await supabase().rpc('biz_block_time', {
      p_staff_id: staff.id,
      p_start: startIso,
      p_end: endIso,
      p_kind: kind,
      p_reason: reason.trim() || undefined,
    });
    if (err) {
      setBusy(false);
      return setError(describeError(codeOf(err)));
    }
    const hit = desk ? await affectedBookings(staff.id, startIso, endIso).catch(() => []) : [];
    setBusy(false);
    if (hit.length) setAffected(hit);
    else {
      onSaved(`${TIME_OFF_LABEL[kind]} ${timeLabel(startIso)}–${timeLabel(endIso)} added`);
      onClose();
    }
  };

  return (
    <Drawer title={`Block time · ${staff.display_name}`} onClose={onClose} testId="block-time">
      {affected ? (
        <AffectedBookings
          title={`${affected.length} booking(s) fall in this time`}
          bookings={affected}
          reason="Staff unavailable"
          onDone={(msg) => {
            onSaved(`Time blocked. ${msg}`);
            onClose();
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Date">
            <input
              type="date"
              className={input}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input className={input} value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label="Type">
            <select
              className={input}
              value={kind}
              onChange={(e) => setKind(e.target.value as CalTimeOff['kind'])}
            >
              <option value="personal">Break / personal</option>
              <option value="training">Training</option>
              <option value="sick">Sick</option>
              <option value="vacation">Vacation</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Note (only managers and the staff member see it)">
            <input
              className={input}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
            Block time
          </button>
        </div>
      )}
    </Drawer>
  );
}

/** Tapping a blocked stretch: details and Remove. */
export function TimeOffDrawer({
  staffName,
  t,
  canRemove,
  onClose,
  onRemoved,
}: {
  staffName: string;
  t: CalTimeOff;
  canRemove: boolean;
  onClose: () => void;
  onRemoved: (msg: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Drawer
      title={`${TIME_OFF_LABEL[t.kind]} · ${staffName}`}
      onClose={onClose}
      testId="time-off-drawer"
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          {timeLabel(t.start)}–{timeLabel(t.end)}
          {t.reason ? ` · ${t.reason}` : ''}
        </p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {canRemove ? (
          <button
            type="button"
            className={btn.danger + ' self-start'}
            onClick={() =>
              void supabase()
                .rpc('biz_remove_block', { p_time_off_id: t.id })
                .then(({ error: err }) => {
                  if (err) return setError(describeError(codeOf(err)));
                  onRemoved('Blocked time removed');
                  onClose();
                })
            }
          >
            Remove
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
