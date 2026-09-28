'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actions,
  isOnline,
  loadCalendar,
  notifyMandatory,
  type BookingCard,
} from '@/lib/biz/bookings';
import {
  VIEW_LABEL,
  addDays,
  bookedPercent,
  dayFrame,
  hoursSummary,
  isoAt,
  offsetIn,
  overlapsDay,
  timeLabel,
  visibleRange,
  weekStart,
  type CalTimeOff,
  type CalView,
  type Calendar,
} from '@/lib/biz/calendar';
import { useBiz } from '@/lib/biz/context';
import { beirutToday, loadServices, loadStaff } from '@/lib/biz/data';
import { NEW_APPOINTMENT_EVENT } from '@/lib/biz/nav';
import { useBookingChanges, useOnline } from '@/lib/biz/realtime';
import { beirutParts } from '@/lib/biz/schedule';
import { useLoad } from '@/lib/biz/use-load';
import { supabase } from '@/lib/supabase';
import { BookingDrawer, bookingError } from '../booking-drawer';
import { NewAppointment, type CreationFlow, type Prefill } from '../new-appointment';
import { Drawer, Toasts, useToasts } from '../overlay';
import { Notice, Toggle, btn } from '../ui';
import { Agenda } from './agenda';
import { BlockTimeDrawer, TimeOffDrawer } from './block-time';
import { CalendarGrid, type GridColumn } from './grid';

type Scope = { mode: 'all' } | { mode: 'some'; ids: string[] };
interface Prefs {
  view?: CalView;
  scope?: Scope;
  zoom?: 10 | 15 | 30;
}

function readPrefs(businessId: string): Prefs {
  try {
    return JSON.parse(window.localStorage.getItem(`cal:${businessId}`) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}
function writePrefs(businessId: string, p: Prefs) {
  try {
    window.localStorage.setItem(`cal:${businessId}`, JSON.stringify(p));
  } catch {
    // private mode / blocked storage: the calendar simply doesn't remember
  }
}

const dayTitle = (date: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

type Move = { b: BookingCard; startIso: string; staffId: string | null; staffName: string };

/** B3 Calendar — the live source of truth for who's doing what, when. */
export function CalendarScreen() {
  const { business, location, role } = useBiz();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const desk = role !== 'staff';
  const online = useOnline();
  const { toasts, push, dismiss } = useToasts();

  const today = beirutToday();
  const [date, setDate] = useState(params.get('date') ?? today);
  const [prefs] = useState(() => readPrefs(business.id));
  const [view, setView] = useState<CalView>(
    prefs.view ?? (typeof window !== 'undefined' && window.innerWidth < 768 ? 'agenda' : 'columns'),
  );
  const [scope, setScope] = useState<Scope>(
    role === 'staff' ? { mode: 'all' } : (prefs.scope ?? { mode: 'all' }),
  );
  const [zoom, setZoom] = useState<10 | 15 | 30>(prefs.zoom ?? 15);
  const [showCancelled, setShowCancelled] = useState(false);
  useEffect(() => writePrefs(business.id, { view, scope, zoom }), [business.id, view, scope, zoom]);

  // drawers
  const [openBooking, setOpenBooking] = useState<string | null>(params.get('booking'));
  const [newAppt, setNewAppt] = useState<{
    prefill: Prefill;
    walkIn: boolean;
    flow: CreationFlow;
  } | null>(
    params.get('new') === '1'
      ? { prefill: { date: today }, walkIn: false, flow: 'button' }
      : params.get('walkin') === '1'
        ? { prefill: { date: today }, walkIn: true, flow: 'walk_in' }
        : null,
  );
  const [block, setBlock] = useState<{ staffId: string; date: string; minutes: number } | null>(
    null,
  );
  const [timeOff, setTimeOff] = useState<{ staffId: string; t: CalTimeOff } | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  useEffect(() => {
    if (params.get('new') || params.get('walkin') || params.get('booking'))
      router.replace(pathname);
  }, [params, pathname, router]);
  useEffect(() => {
    const open = () => setNewAppt({ prefill: { date }, walkIn: false, flow: 'button' });
    window.addEventListener(NEW_APPOINTMENT_EVENT, open);
    return () => window.removeEventListener(NEW_APPOINTMENT_EVENT, open);
  }, [date]);

  // reference data
  const { data: meta } = useLoad(
    () => Promise.all([loadStaff(business.id), loadServices(business.id)]),
    [business.id],
  );
  const allStaff = (meta?.[0] ?? []).filter((s) => s.status === 'active');
  const services = meta?.[1] ?? [];

  // which staff and which days
  const oneStaff = view === 'single' || view === 'week';
  const pickedIds = scope.mode === 'some' ? scope.ids : null;
  const singleId = pickedIds?.[0] ?? allStaff[0]?.id ?? null;
  const staffIds = role === 'staff' ? null : oneStaff ? (singleId ? [singleId] : null) : pickedIds;
  const from = view === 'week' ? weekStart(date) : addDays(date, -1);
  const to = view === 'week' ? addDays(weekStart(date), 6) : addDays(date, 1);

  // calendar data (+ "new online booking" toasts on live refresh)
  const seen = useRef<Set<string> | null>(null);
  const { data: cal, reload } = useLoad(async () => {
    if (!location) return null;
    const c = await loadCalendar(location.id, from, to, staffIds, showCancelled);
    const prev = seen.current;
    if (prev) {
      for (const i of c.items) {
        if (
          !prev.has(i.item_id) &&
          isOnline(i) &&
          (i.status === 'confirmed' || i.status === 'pending')
        ) {
          push({
            text: `New ${i.status === 'pending' ? 'request' : 'booking'} from APP_NAME: ${i.customer?.name ?? 'Customer'} · ${timeLabel(i.starts_at)}`,
          });
        }
      }
    }
    seen.current = new Set(c.items.map((i) => i.item_id));
    return c;
  }, [location?.id, from, to, JSON.stringify(staffIds), showCancelled]);
  useBookingChanges(business.id, () => void reload());

  // "3 appointments from earlier aren't marked" (desk; auto-complete runs at end + 6 h anyway)
  const { data: unmarked, reload: reloadUnmarked } = useLoad(async () => {
    if (!desk) return [];
    const { data } = await supabase().rpc('biz_today', { p_business_id: business.id });
    return ((data as { unmarked_past?: string[] } | null)?.unmarked_past ?? []) as string[];
  }, [business.id, desk]);

  const refreshAll = () => {
    void reload();
    void reloadUnmarked();
  };

  // keyboard: N new, T today, ←/→ day, D/W/L views, Esc closes drawers (in Drawer)
  const anyDrawer = !!(openBooking || newAppt || block || timeOff || move);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (anyDrawer || e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return;
      const step = view === 'week' ? 7 : 1;
      const k = e.key.toLowerCase();
      if (k === 'n' && online) {
        e.preventDefault();
        setNewAppt({ prefill: { date }, walkIn: false, flow: 'keyboard' });
      } else if (k === 't') setDate(beirutToday());
      else if (e.key === 'ArrowLeft') setDate((d) => addDays(d, -step));
      else if (e.key === 'ArrowRight') setDate((d) => addDays(d, step));
      else if (k === 'd') setView('columns');
      else if (k === 'w') setView('week');
      else if (k === 'l') setView('agenda');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyDrawer, date, online, view]);

  const columns: GridColumn[] = useMemo(() => {
    if (!cal) return [];
    const base = `/biz/${business.id}/staff/`;
    if (view === 'week') {
      const s = cal.staff[0];
      if (!s) return [];
      return Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i)).map((d) => {
        const frame = dayFrame(d);
        return {
          key: d,
          title: dayTitle(d),
          subtitle: hoursSummary(frame, s.working),
          frame,
          staff: s,
          items: cal.items.filter((it) => it.staff_id === s.id),
        };
      });
    }
    const frame = dayFrame(date);
    return cal.staff.map((s) => {
      const pct = bookedPercent(frame, s, cal.items);
      return {
        key: s.id,
        title: s.display_name,
        subtitle: `${hoursSummary(frame, s.working)}${pct !== null ? ` · ${pct}%` : ''}`,
        href: desk ? base + s.id : undefined,
        frame,
        staff: s,
        items: cal.items.filter((it) => it.staff_id === s.id),
      };
    });
  }, [business.id, cal, date, desk, view]);

  const range = useMemo(() => {
    if (!cal || !columns.length) return { from: 540, to: 1140 };
    return columns.reduce(
      (r, c) => {
        const v = visibleRange(c.frame, { ...cal, staff: [c.staff], items: c.items } as Calendar);
        return { from: Math.min(r.from, v.from), to: Math.max(r.to, v.to) };
      },
      { from: 1440, to: 0 },
    );
  }, [cal, columns]);

  const myStaffId = cal?.my_staff_id ?? null;
  const canCreate = (col: GridColumn) => online && (desk || col.staff.id === myStaffId);
  const canMove = (b: BookingCard) =>
    online &&
    (b.status === 'confirmed' || b.status === 'pending') &&
    Date.parse(b.starts_at) > Date.now() &&
    (desk || b.staff_id === myStaffId);

  const staffName = (id: string) =>
    allStaff.find((s) => s.id === id)?.display_name ??
    cal?.staff.find((s) => s.id === id)?.display_name ??
    'Staff';

  const conflictText = (staffId: string, startIso: string, b: BookingCard) => {
    const end = Date.parse(startIso) + (Date.parse(b.ends_at) - Date.parse(b.starts_at));
    const hit = cal?.items.find(
      (i) =>
        i.staff_id === staffId &&
        i.item_id !== b.item_id &&
        (i.status === 'confirmed' || i.status === 'pending' || i.status === 'held') &&
        Date.parse(i.starts_at) < end &&
        Date.parse(i.ends_at) > Date.parse(startIso),
    );
    return hit
      ? `${staffName(staffId)} already has an appointment ${timeLabel(hit.starts_at)}–${timeLabel(hit.ends_at)}`
      : `${staffName(staffId)} is busy at that time`;
  };

  const staffChips = role === 'staff' ? [] : allStaff;
  const toggleStaff = (id: string) => {
    if (oneStaff) return setScope({ mode: 'some', ids: [id] });
    if (scope.mode === 'all') return setScope({ mode: 'some', ids: [id] });
    const ids = scope.ids.includes(id) ? scope.ids.filter((x) => x !== id) : [...scope.ids, id];
    setScope(ids.length ? { mode: 'some', ids } : { mode: 'all' });
  };
  const chipOn = (id: string) =>
    oneStaff ? singleId === id : scope.mode === 'some' && scope.ids.includes(id);

  const frame = dayFrame(date);
  const title = view === 'week' ? `Week of ${dayTitle(weekStart(date))}` : dayTitle(date);
  const agendaItems = (cal?.items ?? []).filter((i) => overlapsDay(frame, i.starts_at, i.ends_at));

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col md:h-dvh">
      {/* toolbar */}
      <div className="flex flex-col gap-2 border-b border-line-200 bg-surface-0 px-3 py-2 md:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn.secondary} onClick={() => setDate(beirutToday())}>
            Today
          </button>
          <button
            type="button"
            className={btn.secondary}
            aria-label="Previous"
            onClick={() => setDate((d) => addDays(d, view === 'week' ? -7 : -1))}
          >
            ‹
          </button>
          <button
            type="button"
            className={btn.secondary}
            aria-label="Next"
            onClick={() => setDate((d) => addDays(d, view === 'week' ? 7 : 1))}
          >
            ›
          </button>
          <input
            type="date"
            aria-label="Date"
            className="h-10 rounded-control border border-line-200 px-2 text-sm"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <h1 className="me-auto text-base font-semibold" data-testid="calendar-title">
            {title}
          </h1>
          <div
            className="flex overflow-hidden rounded-control border border-line-200"
            role="tablist"
            aria-label="View"
          >
            {(['columns', 'single', 'week', 'agenda'] as CalView[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`h-10 px-3 text-sm ${view === v ? 'bg-accent-600 text-white' : 'bg-surface-0'}`}
                onClick={() => setView(v)}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={btn.secondary}
            disabled={!online}
            onClick={() => setNewAppt({ prefill: { date: today }, walkIn: true, flow: 'walk_in' })}
          >
            Walk-in
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={!online}
            onClick={() => setNewAppt({ prefill: { date }, walkIn: false, flow: 'button' })}
          >
            + New appointment
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {staffChips.length ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Staff">
              {!oneStaff ? (
                <button
                  type="button"
                  aria-pressed={scope.mode === 'all'}
                  className={`rounded-full border px-3 py-1 ${scope.mode === 'all' ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
                  onClick={() => setScope({ mode: 'all' })}
                >
                  All staff
                </button>
              ) : null}
              {staffChips.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={chipOn(s.id)}
                  className={`rounded-full border px-3 py-1 ${chipOn(s.id) ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
                  onClick={() => toggleStaff(s.id)}
                >
                  {s.display_name}
                </button>
              ))}
            </div>
          ) : null}
          <span className="ms-auto flex items-center gap-3">
            {view !== 'agenda' ? (
              <select
                aria-label="Zoom"
                className="h-9 rounded-control border border-line-200 px-2"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value) as 10 | 15 | 30)}
              >
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
              </select>
            ) : null}
            <Toggle label="Show cancelled" checked={showCancelled} onChange={setShowCancelled} />
          </span>
        </div>
      </div>

      {!online ? (
        <div className="bg-warning-600 px-4 py-1.5 text-sm text-white" role="status">
          You&apos;re offline — the calendar is read-only until you reconnect.
        </div>
      ) : null}
      {desk && unmarked && unmarked.length ? (
        <div
          className="flex flex-wrap items-center gap-3 border-b border-line-200 bg-surface-50 px-4 py-2 text-sm"
          data-testid="unmarked-banner"
        >
          <span>
            {unmarked.length} past appointment{unmarked.length === 1 ? '' : 's'} not marked yet.
          </span>
          <button
            type="button"
            className={btn.link}
            disabled={!online}
            onClick={() =>
              void actions
                .completeMany(unmarked)
                .then((n) => {
                  push({ text: `${n} marked completed` });
                  refreshAll();
                })
                .catch((e) => push({ text: bookingError(e).text, tone: 'danger' }))
            }
          >
            Mark all completed
          </button>
        </div>
      ) : null}

      {/* body */}
      {!cal ? (
        <p className="p-4 text-sm text-ink-500">Loading…</p>
      ) : !cal.staff.length ? (
        <div className="p-4">
          <Notice>
            {desk
              ? 'Add your team to start using the calendar (Staff).'
              : 'You don’t have a staff profile at this business yet.'}
          </Notice>
        </div>
      ) : view === 'agenda' ? (
        <div className="flex-1 overflow-y-auto">
          <Agenda
            frame={frame}
            staff={cal.staff}
            items={agendaItems}
            onOpen={(b) => setOpenBooking(b.booking_id)}
            onGap={
              online
                ? () => setNewAppt({ prefill: { date }, walkIn: false, flow: 'button' })
                : undefined
            }
          />
        </div>
      ) : (
        <>
          {!cal.items.some((i) => overlapsDay(frame, i.starts_at, i.ends_at)) && view !== 'week' ? (
            <p className="px-4 pt-2 text-xs text-ink-500">Click any time to add an appointment.</p>
          ) : null}
          <CalendarGrid
            columns={columns}
            range={range}
            zoom={zoom}
            canMove={canMove}
            canCreate={canCreate}
            onSlot={(col, offset) => {
              const p = beirutParts(isoAt(col.frame, offset));
              setNewAppt({
                prefill: { date: p.date, minutes: p.minutes, staffId: col.staff.id },
                walkIn: false,
                flow: 'slot',
              });
            }}
            onOpen={(b) => setOpenBooking(b.booking_id)}
            onMove={(b, col, offset) => {
              const startIso = isoAt(col.frame, offset);
              const staffId = col.staff.id !== b.staff_id ? col.staff.id : null;
              if (!staffId && Date.parse(startIso) === Date.parse(b.starts_at)) return;
              setMove({ b, startIso, staffId, staffName: col.staff.display_name });
            }}
            onTimeOff={(col, t) => setTimeOff({ staffId: col.staff.id, t })}
            onBlock={(col) => {
              const start = Math.max(
                range.from,
                Math.min(offsetIn(col.frame, new Date().toISOString()), range.to - 60),
              );
              const p = beirutParts(isoAt(col.frame, Math.floor(start / 15) * 15));
              setBlock({ staffId: col.staff.id, date: col.frame.date, minutes: p.minutes });
            }}
          />
        </>
      )}

      {openBooking ? (
        <BookingDrawer
          bookingId={openBooking}
          businessId={business.id}
          role={role}
          staffOptions={allStaff.map((s) => ({ id: s.id, display_name: s.display_name }))}
          onClose={() => setOpenBooking(null)}
          onChanged={(msg) => {
            push({ text: msg });
            refreshAll();
          }}
        />
      ) : null}
      {newAppt && location ? (
        <NewAppointment
          businessId={business.id}
          locationId={location.id}
          role={role}
          myStaffId={myStaffId}
          staff={allStaff.map((s) => ({ id: s.id, display_name: s.display_name }))}
          services={services}
          prefill={newAppt.prefill}
          walkIn={newAppt.walkIn}
          flow={newAppt.flow}
          onClose={() => setNewAppt(null)}
          onSaved={(saved, again) => {
            if (!again) setNewAppt(null);
            const p = beirutParts(saved.endsAt);
            if (p.date !== date && !again) setDate(beirutParts(saved.endsAt).date);
            push(
              {
                text: `Saved · ${saved.summary}`,
                action: {
                  label: 'Undo',
                  run: () =>
                    void actions
                      .undoManual(saved.bookingId)
                      .then(() => {
                        push({ text: 'Undone' });
                        refreshAll();
                      })
                      .catch((e) => push({ text: bookingError(e).text, tone: 'danger' })),
                },
              },
              10_000,
            );
            refreshAll();
          }}
        />
      ) : null}
      {block ? (
        <BlockTimeDrawer
          staff={{ id: block.staffId, display_name: staffName(block.staffId) }}
          date={block.date}
          minutes={block.minutes}
          desk={desk}
          onClose={() => setBlock(null)}
          onSaved={(msg) => {
            push({ text: msg });
            refreshAll();
          }}
        />
      ) : null}
      {timeOff ? (
        <TimeOffDrawer
          staffName={staffName(timeOff.staffId)}
          t={timeOff.t}
          canRemove={online && (desk || timeOff.staffId === myStaffId)}
          onClose={() => setTimeOff(null)}
          onRemoved={(msg) => {
            push({ text: msg });
            refreshAll();
          }}
        />
      ) : null}
      {move ? (
        <MoveConfirm
          move={move}
          desk={desk}
          onClose={() => setMove(null)}
          onDone={(msg) => {
            setMove(null);
            push({ text: msg });
            refreshAll();
          }}
          onConflict={(text) => {
            setMove(null);
            push({ text, tone: 'danger' });
            refreshAll();
          }}
          conflictText={conflictText}
        />
      ) : null}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

/** Drag-to-move confirmation: "Notify {customer} on WhatsApp?" (mandatory if they chose that person). */
function MoveConfirm({
  move,
  desk,
  onClose,
  onDone,
  onConflict,
  conflictText,
}: {
  move: Move;
  desk: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  onConflict: (text: string) => void;
  conflictText: (staffId: string, startIso: string, b: BookingCard) => string;
}) {
  const { b, startIso, staffId, staffName } = move;
  const mandatory = !!staffId && notifyMandatory(b);
  const [notify, setNotify] = useState(isOnline(b));
  const [outside, setOutside] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const who = b.customer?.name ?? 'the customer';

  const go = async (allowOutside: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await actions.reschedule(b.booking_id, startIso, staffId, notify || mandatory, allowOutside);
      onDone(`Moved to ${timeLabel(startIso)}${staffId ? ` with ${staffName}` : ''}`);
    } catch (e) {
      const err = bookingError(e, staffName);
      if (err.code === 'STAFF_NOT_FREE')
        return onConflict(conflictText(staffId ?? b.staff_id, startIso, b));
      if (err.code === 'OUTSIDE_HOURS' && desk) setOutside(true);
      setError(err.text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title="Move appointment" onClose={onClose} testId="move-confirm">
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Move <span className="font-semibold">{who}</span> · {b.service_name} to{' '}
          <span className="font-semibold">
            {dayTitle(beirutParts(startIso).date)} {timeLabel(startIso)}
          </span>
          {staffId ? (
            <>
              {' '}
              with <span className="font-semibold">{staffName}</span>
            </>
          ) : null}
          ?
        </p>
        {mandatory ? (
          <Notice tone="warning">
            {who} chose {b.staff_name}. They&apos;ll be notified of the change.
          </Notice>
        ) : null}
        {b.customer?.phone ? (
          <Toggle
            label={`Notify ${who} on WhatsApp`}
            checked={notify || mandatory}
            disabled={mandatory}
            onChange={setNotify}
          />
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btn.primary}
            disabled={busy}
            onClick={() => void go(false)}
          >
            Move
          </button>
          {outside ? (
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => void go(true)}
            >
              Move anyway (outside hours)
            </button>
          ) : null}
          <button type="button" className={btn.link} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Drawer>
  );
}
