'use client';

import { useState } from 'react';
import type { Enums, TablesUpdate } from '@app/db';
import { useBiz } from '@/lib/biz/context';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Field, Notice, Section, Toggle, btn, codeOf, input } from '../ui';

/** Booking rules (Phase 2 B1 step 8 / B12). Defaults: instant, 1 h notice, 30 days, 2 h cancel window. */
export function RulesSection({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const { business, settings, refresh } = useBiz();
  const s = settings;
  const [mode, setMode] = useState<Enums<'booking_mode'>>(s?.booking_mode ?? 'instant');
  const [expiry, setExpiry] = useState(s?.request_expiry_minutes ?? 240);
  const [notice, setNotice] = useState(s?.min_notice_minutes ?? 60);
  const [advance, setAdvance] = useState(s?.max_advance_days ?? 30);
  const [slot, setSlot] = useState(s?.slot_interval_minutes ?? 15);
  const [cancelWin, setCancelWin] = useState(s?.cancellation_window_minutes ?? 120);
  const [choice, setChoice] = useState<Enums<'staff_choice_mode'>>(
    s?.staff_choice_mode ?? 'any_or_choose',
  );
  const [rule, setRule] = useState<Enums<'assignment_rule'>>(s?.assignment_rule ?? 'least_booked');
  const [showPrices, setShowPrices] = useState(s?.show_staff_price_differences ?? true);
  const [showCounts, setShowCounts] = useState(s?.show_staff_appointment_counts ?? true);
  const [notifyReassign, setNotifyReassign] = useState(s?.notify_customer_on_any_reassign ?? false);
  const [maxActive, setMaxActive] = useState(s?.max_active_bookings_per_customer ?? 3);
  const [receptionRevenue, setReceptionRevenue] = useState(s?.reception_sees_revenue ?? false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (advance * 1440 <= notice) {
      setMsg({
        tone: 'danger',
        text: 'Minimum notice must be shorter than how far ahead customers can book.',
      });
      return;
    }
    setBusy(true);
    setMsg(null);
    const patch: TablesUpdate<'business_settings'> = {
      booking_mode: mode,
      request_expiry_minutes: expiry,
      min_notice_minutes: notice,
      max_advance_days: advance,
      slot_interval_minutes: slot,
      cancellation_window_minutes: cancelWin,
      staff_choice_mode: choice,
      assignment_rule: rule,
      show_staff_price_differences: showPrices,
      show_staff_appointment_counts: showCounts,
      notify_customer_on_any_reassign: notifyReassign,
      max_active_bookings_per_customer: maxActive,
      reception_sees_revenue: receptionRevenue,
    };
    const { error } = await supabase()
      .from('business_settings')
      .update(patch)
      .eq('business_id', business.id);
    setBusy(false);
    if (error) return setMsg({ tone: 'danger', text: describeError(codeOf(error)) });
    await refresh();
    setMsg({ tone: 'success', text: 'Saved. Changes apply to new bookings.' });
    onSaved?.();
  };

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <Section
      title="Booking rules"
      description="How customers book you online. Changes only affect new bookings."
    >
      <Field label="Online bookings">
        <select
          className={input}
          value={mode}
          onChange={(e) => setMode(e.target.value as Enums<'booking_mode'>)}
        >
          <option value="instant">Instant booking (recommended)</option>
          <option value="request">Approve each request</option>
        </select>
      </Field>
      {mode === 'request' ? (
        <Field
          label="Requests expire after (minutes)"
          hint="Never later than the appointment itself."
        >
          <input
            className={input}
            type="number"
            min={15}
            max={1440}
            value={expiry}
            onChange={(e) => setExpiry(num(e.target.value))}
          />
        </Field>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Minimum notice (minutes)">
          <input
            className={input}
            type="number"
            min={0}
            max={10080}
            step={15}
            value={notice}
            onChange={(e) => setNotice(num(e.target.value))}
          />
        </Field>
        <Field label="Book up to (days ahead)">
          <input
            className={input}
            type="number"
            min={1}
            max={365}
            value={advance}
            onChange={(e) => setAdvance(num(e.target.value))}
          />
        </Field>
        <Field label="Free cancellation until (minutes before)">
          <input
            className={input}
            type="number"
            min={0}
            max={10080}
            step={30}
            value={cancelWin}
            onChange={(e) => setCancelWin(num(e.target.value))}
          />
        </Field>
      </div>
      {!compact ? (
        <>
          <Field label="Time slots every">
            <select
              className={input}
              value={slot}
              onChange={(e) => setSlot(Number(e.target.value))}
            >
              {[5, 10, 15, 20, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Field>
          <Field label="Staff choice">
            <select
              className={input}
              value={choice}
              onChange={(e) => setChoice(e.target.value as Enums<'staff_choice_mode'>)}
            >
              <option value="any_or_choose">Any available, or choose someone (default)</option>
              <option value="any_only">Any available only</option>
              <option value="choose_only">Customer chooses only</option>
            </select>
          </Field>
          <Field label={'"Any available" assigns'}>
            <select
              className={input}
              value={rule}
              onChange={(e) => setRule(e.target.value as Enums<'assignment_rule'>)}
            >
              <option value="least_booked">Least booked that day (default)</option>
              <option value="priority">Priority order</option>
              <option value="round_robin">Round robin</option>
              <option value="minimize_gaps">Minimize gaps / first available</option>
            </select>
          </Field>
          <Field label="Max active bookings per customer">
            <input
              className={input}
              type="number"
              min={1}
              max={20}
              value={maxActive}
              onChange={(e) => setMaxActive(Math.min(20, Math.max(1, num(e.target.value))))}
            />
          </Field>
          <Toggle
            label="Show staff price differences to customers"
            checked={showPrices}
            onChange={setShowPrices}
          />
          <Toggle
            label="Show verified appointment counts on staff cards"
            checked={showCounts}
            onChange={setShowCounts}
          />
          <Toggle
            label={'Notify customers when an "Any available" booking is reassigned'}
            description="Bookings where the customer chose someone always notify."
            checked={notifyReassign}
            onChange={setNotifyReassign}
          />
          <Toggle
            label="Reception can see customer spend"
            checked={receptionRevenue}
            onChange={setReceptionRevenue}
          />
        </>
      ) : null}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <button
        type="button"
        className={btn.primary + ' self-start'}
        disabled={busy}
        onClick={() => void save()}
      >
        Save rules
      </button>
    </Section>
  );
}
