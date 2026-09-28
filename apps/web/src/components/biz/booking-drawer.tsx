'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  EVENT_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  actions,
  getBooking,
  isOnline,
  notifyMandatory,
  priceText,
  reassignOptions,
  type BookingCard,
  type BookingDetail,
  type ReassignOption,
} from '@/lib/biz/bookings';
import { parseTime, reliabilityHint, timeLabel } from '@/lib/biz/calendar';
import type { Role } from '@/lib/biz/context';
import { beirutParts, beirutToUtc, fmtBeirut } from '@/lib/biz/schedule';
import { useLoad } from '@/lib/biz/use-load';
import { useNow } from '@/lib/biz/use-now';
import { describeError } from '@/lib/copy';
import { Drawer } from './overlay';
import { Field, Notice, Toggle, btn, codeOf, input } from './ui';

const DESK: Role[] = ['owner', 'manager', 'reception'];

/** Code + friendly copy for booking RPC errors, naming the staff member where it helps. */
export function bookingError(e: unknown, staffName?: string): { code: string; text: string } {
  const code = codeOf(e);
  return { code, text: describeError(code, { staff: staffName ?? 'This staff member' }) };
}

/**
 * Appointment popover / booking drawer (Phase 2 B3 §4.3, B5 drawer): customer, service, staff,
 * time, status, note, source; status actions; move / reassign / cancel; event timeline.
 */
export function BookingDrawer({
  bookingId,
  businessId,
  role,
  staffOptions,
  onClose,
  onChanged,
}: {
  bookingId: string;
  businessId: string;
  role: Role;
  staffOptions: { id: string; display_name: string }[];
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const { data, reload } = useLoad(() => getBooking(bookingId), [bookingId]);
  const [panel, setPanel] = useState<'none' | 'move' | 'reassign' | 'cancel' | 'decline' | 'note'>(
    'none',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, msg: string, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged(msg);
      if (close) onClose();
      else {
        setPanel('none');
        await reload();
      }
    } catch (e) {
      setError(bookingError(e, data?.staff_name).text);
    } finally {
      setBusy(false);
    }
  };

  const b = data;
  const desk = DESK.includes(role);
  const now = useNow();
  const started = b ? Date.parse(b.starts_at) <= now : false;
  const future = b ? Date.parse(b.starts_at) > now : false;

  return (
    <Drawer
      title={b ? `${b.service_name} · ${timeLabel(b.starts_at)}` : 'Appointment'}
      onClose={onClose}
      testId="booking-drawer"
    >
      {!b ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4 text-sm">
          <CustomerBlock b={b} businessId={businessId} />

          <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
            <dt className="text-ink-500">When</dt>
            <dd data-testid="drawer-when">
              {fmtBeirut(b.starts_at)}–{timeLabel(b.ends_at)} · {b.duration_min} min
            </dd>
            <dt className="text-ink-500">Staff</dt>
            <dd data-testid="drawer-staff">
              {b.staff_name}
              {b.requested ? (
                <span
                  className="ms-2 text-xs font-medium text-star-500"
                  title="The customer chose this person"
                >
                  ★ Requested
                </span>
              ) : null}
            </dd>
            <dt className="text-ink-500">Status</dt>
            <dd data-testid="drawer-status">
              {STATUS_LABEL[b.status]}
              {b.status === 'pending' && b.expires_at
                ? ` · expires ${fmtBeirut(b.expires_at)}`
                : ''}
              {b.status === 'cancelled' && b.cancel_reason ? ` · ${b.cancel_reason}` : ''}
            </dd>
            <dt className="text-ink-500">Source</dt>
            <dd>{SOURCE_LABEL[b.source] ?? b.source}</dd>
            {priceText(b) ? (
              <>
                <dt className="text-ink-500">Price</dt>
                <dd>{priceText(b)}</dd>
              </>
            ) : null}
            <dt className="text-ink-500">Reference</dt>
            <dd className="font-mono">{b.ref}</dd>
            {b.customer_note ? (
              <>
                <dt className="text-ink-500">Customer note</dt>
                <dd>{b.customer_note}</dd>
              </>
            ) : null}
            <dt className="text-ink-500">Note</dt>
            <dd>
              {b.internal_note ?? <span className="text-ink-500">—</span>}{' '}
              {desk ? (
                <button type="button" className={btn.link} onClick={() => setPanel('note')}>
                  Edit
                </button>
              ) : null}
            </dd>
          </dl>

          {error ? <Notice tone="danger">{error}</Notice> : null}

          {/* ── status actions ── */}
          <div className="flex flex-wrap gap-2" data-testid="drawer-actions">
            {b.status === 'pending' && desk ? (
              <>
                <button
                  type="button"
                  className={btn.primary}
                  disabled={busy}
                  onClick={() => void run(() => actions.accept(b.booking_id), 'Request accepted')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={busy}
                  onClick={() => setPanel('decline')}
                >
                  Decline
                </button>
              </>
            ) : null}
            {b.status === 'confirmed' && started ? (
              <>
                <button
                  type="button"
                  className={btn.primary}
                  disabled={busy}
                  onClick={() => void run(() => actions.complete(b.booking_id), 'Marked completed')}
                >
                  Complete
                </button>
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={busy}
                  onClick={() => void run(() => actions.noShow(b.booking_id), 'Marked no-show')}
                >
                  No-show
                </button>
              </>
            ) : null}
            {b.status === 'completed' && started && now < Date.parse(b.starts_at) + 86_400_000 ? (
              <button
                type="button"
                className={btn.secondary}
                disabled={busy}
                onClick={() => void run(() => actions.noShow(b.booking_id), 'Marked no-show')}
              >
                Mark no-show
              </button>
            ) : null}
            {b.status === 'no_show' &&
            !b.no_show_disputed &&
            now < Date.parse(b.starts_at) + 86_400_000 ? (
              <button
                type="button"
                className={btn.secondary}
                disabled={busy}
                onClick={() => void run(() => actions.undoNoShow(b.booking_id), 'No-show undone')}
              >
                Undo no-show
              </button>
            ) : null}
            {(b.status === 'confirmed' || b.status === 'pending') && future ? (
              <button type="button" className={btn.secondary} onClick={() => setPanel('move')}>
                Reschedule
              </button>
            ) : null}
            {(b.status === 'confirmed' || b.status === 'pending') && desk ? (
              <button type="button" className={btn.secondary} onClick={() => setPanel('reassign')}>
                Change staff
              </button>
            ) : null}
            {b.status === 'confirmed' || (b.status === 'pending' && !desk) ? (
              <button type="button" className={btn.danger} onClick={() => setPanel('cancel')}>
                Cancel
              </button>
            ) : null}
          </div>

          {panel === 'move' ? (
            <MovePanel
              b={b}
              desk={desk}
              staffOptions={desk ? staffOptions : []}
              busy={busy}
              onCancel={() => setPanel('none')}
              onMove={(startIso, staffId, notify, outside) =>
                run(
                  () => actions.reschedule(b.booking_id, startIso, staffId, notify, outside),
                  'Appointment moved',
                )
              }
              onError={setError}
            />
          ) : null}
          {panel === 'reassign' ? (
            <ReassignPanel
              b={b}
              busy={busy}
              onCancel={() => setPanel('none')}
              onPick={(staffId, notify) =>
                run(() => actions.reassign(b.item_id, staffId, notify), 'Staff changed')
              }
            />
          ) : null}
          {panel === 'cancel' ? (
            <ReasonPanel
              title="Cancel appointment"
              cta="Cancel appointment"
              required={isOnline(b)}
              notifyDefault={b.customer?.phone != null}
              notifyLocked={isOnline(b)}
              busy={busy}
              onCancel={() => setPanel('none')}
              onConfirm={(reason, notify) =>
                run(
                  () => actions.cancel(b.booking_id, reason, notify),
                  'Appointment cancelled',
                  true,
                )
              }
            />
          ) : null}
          {panel === 'decline' ? (
            <ReasonPanel
              title="Decline request"
              cta="Decline"
              required={false}
              notifyDefault
              notifyLocked
              busy={busy}
              onCancel={() => setPanel('none')}
              onConfirm={(reason) =>
                run(() => actions.decline(b.booking_id, reason), 'Request declined', true)
              }
            />
          ) : null}
          {panel === 'note' ? (
            <NotePanel
              initial={b.internal_note ?? ''}
              busy={busy}
              onCancel={() => setPanel('none')}
              onSave={(note) => run(() => actions.note(b.booking_id, note), 'Note saved')}
            />
          ) : null}

          <Timeline b={b} />
        </div>
      )}
    </Drawer>
  );
}

function CustomerBlock({ b, businessId }: { b: BookingCard; businessId: string }) {
  const c = b.customer;
  if (!c) return <p className="font-medium">Walk-in (no details)</p>;
  const digits = c.phone?.replace(/\D/g, '');
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-surface-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/biz/${businessId}/customers/${c.id}`}
          className="font-semibold hover:underline"
          data-testid="drawer-customer"
        >
          {c.name}
        </Link>
        <span className="flex gap-1 text-xs">
          {c.is_new ? (
            <span className="rounded bg-info-600 px-1.5 py-0.5 text-white">New</span>
          ) : null}
          {reliabilityHint(c.reliability) ? (
            <span
              className={`rounded px-1.5 py-0.5 ${c.reliability === 'reliable' ? 'bg-success-600 text-white' : 'bg-warning-600 text-white'}`}
            >
              {reliabilityHint(c.reliability)}
            </span>
          ) : null}
        </span>
      </div>
      {c.phone ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono">{c.phone}</span>
          <a className={btn.link} href={`tel:${c.phone}`}>
            Call
          </a>
          <a className={btn.link} href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </div>
      ) : null}
      {c.pinned_note ? <p className="text-sm">📌 {c.pinned_note}</p> : null}
    </div>
  );
}

function MovePanel({
  b,
  desk,
  staffOptions,
  busy,
  onCancel,
  onMove,
  onError,
}: {
  b: BookingDetail;
  desk: boolean;
  staffOptions: { id: string; display_name: string }[];
  busy: boolean;
  onCancel: () => void;
  onMove: (
    startIso: string,
    staffId: string | null,
    notify: boolean,
    outside: boolean,
  ) => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const p = beirutParts(b.starts_at);
  const [date, setDate] = useState(p.date);
  const [time, setTime] = useState(timeLabel(b.starts_at));
  const [staffId, setStaffId] = useState(b.staff_id);
  const staffChanged = staffId !== b.staff_id;
  const mandatory = staffChanged && notifyMandatory(b);
  const [notify, setNotify] = useState(isOnline(b));
  const [outside, setOutside] = useState(false);

  const submit = async () => {
    const m = parseTime(time);
    if (m === null) return onError('Check the time (e.g. 16:30).');
    await onMove(beirutToUtc(date, m), staffChanged ? staffId : null, notify || mandatory, outside);
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-control border border-line-200 p-3"
      data-testid="move-panel"
    >
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
          <input className={input} value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      {staffOptions.length ? (
        <Field label="Staff">
          <select className={input} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {mandatory && b.customer ? (
        <Notice tone="warning">
          {b.customer.name} chose {b.staff_name}. They&apos;ll be notified of the change.
        </Notice>
      ) : null}
      {b.customer?.phone ? (
        <Toggle
          label={`Notify ${b.customer.name} on WhatsApp`}
          checked={notify || mandatory}
          disabled={mandatory || b.created_by_kind === 'customer'}
          onChange={setNotify}
        />
      ) : null}
      {desk ? (
        <Toggle label="Allow outside working hours" checked={outside} onChange={setOutside} />
      ) : null}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void submit()}>
          Move
        </button>
        <button type="button" className={btn.link} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

export function ReassignPanel({
  b,
  busy,
  onCancel,
  onPick,
}: {
  b: BookingCard;
  busy: boolean;
  onCancel: () => void;
  onPick: (staffId: string, notify: boolean) => Promise<void>;
}) {
  const { data } = useLoad(() => reassignOptions(b.item_id), [b.item_id]);
  const mandatory = notifyMandatory(b);
  const [notify, setNotify] = useState(mandatory);
  const options: ReassignOption[] = data ?? [];
  return (
    <div
      className="flex flex-col gap-3 rounded-control border border-line-200 p-3"
      data-testid="reassign-panel"
    >
      <p className="font-medium">Who takes it instead?</p>
      {mandatory && b.customer ? (
        <Notice tone="warning">
          {b.customer.name} chose {b.staff_name}. They&apos;ll be notified of the change.
        </Notice>
      ) : null}
      {!data ? <p className="text-ink-500">Loading…</p> : null}
      {data && !options.length ? (
        <p className="text-ink-500">No one else performs this service.</p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {options.map((o) => (
          <li key={o.staff_id} className="flex items-center justify-between gap-2">
            <span>
              {o.display_name}{' '}
              <span className="text-xs text-ink-500">
                {!o.is_free ? '· busy' : !o.in_hours ? '· outside their hours' : '· free'}
              </span>
            </span>
            <button
              type="button"
              className={btn.secondary}
              disabled={busy || !o.is_free}
              onClick={() => void onPick(o.staff_id, notify || mandatory)}
            >
              Give to {o.display_name.split(' ')[0]}
            </button>
          </li>
        ))}
      </ul>
      {b.customer?.phone && !mandatory ? (
        <Toggle label={`Notify ${b.customer.name}`} checked={notify} onChange={setNotify} />
      ) : null}
      <button type="button" className={btn.link + ' self-start'} onClick={onCancel}>
        Back
      </button>
    </div>
  );
}

function ReasonPanel({
  title,
  cta,
  required,
  notifyDefault,
  notifyLocked,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  cta: string;
  required: boolean;
  notifyDefault: boolean;
  notifyLocked: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, notify: boolean) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(notifyDefault);
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line-200 p-3">
      <p className="font-medium">{title}</p>
      <Field label={required ? 'Reason (the customer sees it)' : 'Reason (optional)'}>
        <input
          className={input}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      {!notifyLocked ? (
        <Toggle label="Notify the customer" checked={notify} onChange={setNotify} />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.danger}
          disabled={busy || (required && !reason.trim())}
          onClick={() => void onConfirm(reason.trim(), notifyLocked || notify)}
        >
          {cta}
        </button>
        <button type="button" className={btn.link} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

function NotePanel({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState(initial);
  return (
    <div className="flex flex-col gap-3 rounded-control border border-line-200 p-3">
      <Field label="Internal note">
        <textarea
          className={input + ' h-20 py-2'}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={busy}
          onClick={() => void onSave(note.trim())}
        >
          Save note
        </button>
        <button type="button" className={btn.link} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}

function Timeline({ b }: { b: BookingDetail }) {
  if (!b.events.length) return null;
  return (
    <section>
      <h3 className="mb-2 font-semibold">History</h3>
      <ol
        className="flex flex-col gap-2 border-s border-line-200 ps-3"
        data-testid="drawer-timeline"
      >
        {b.events.map((e, i) => (
          <li key={i}>
            <p>
              <span className="font-medium">{EVENT_LABEL[e.event] ?? e.event}</span>
              {e.event === 'rescheduled' && typeof e.data.new_start === 'string'
                ? ` to ${fmtBeirut(e.data.new_start)}`
                : ''}
              {e.data.undo ? ' (undone)' : ''}
              {typeof e.data.reason === 'string' && e.data.reason ? ` · “${e.data.reason}”` : ''}
            </p>
            <p className="text-xs text-ink-500">
              {e.actor_name} · {fmtBeirut(e.created_at)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
