'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SOURCE_ICON, type BookingCard } from '@/lib/biz/bookings';
import {
  TIME_OFF_LABEL,
  hourMarks,
  isoAt,
  offShift,
  offsetIn,
  overlapsDay,
  placeLanes,
  timeLabel,
  type CalStaff,
  type CalTimeOff,
  type DayFrame,
} from '@/lib/biz/calendar';

export interface GridColumn {
  key: string;
  title: string;
  subtitle?: string;
  href?: string;
  frame: DayFrame;
  staff: CalStaff;
  items: BookingCard[];
}

const ROW_PX = 22;

function blockClass(b: BookingCard): string {
  switch (b.status) {
    case 'pending':
      return 'border-2 border-dashed border-warning-600 bg-surface-0';
    case 'completed':
      return 'border border-line-200 bg-surface-100 text-ink-700';
    case 'cancelled':
      return 'border border-line-200 bg-surface-0 text-ink-500 line-through opacity-70';
    case 'no_show':
      return 'border border-danger-600 bg-surface-0 text-danger-600';
    case 'held':
      return 'border border-dashed border-line-200 bg-surface-50 text-ink-500';
    default:
      return b.requested
        ? 'border border-star-500 bg-accent-600/10'
        : 'border border-accent-600/40 bg-accent-600/10';
  }
}

export function blockLabel(b: BookingCard) {
  return `${b.customer?.name ?? (b.status === 'held' ? 'Online booking in progress' : 'Walk-in')} · ${b.service_name} · ${timeLabel(b.starts_at)} · ${b.staff_name}`;
}

/**
 * Time grid for Day · Columns (one column per staff), Day · Single (one column) and Week
 * (one column per day). Rows are `zoom` minutes; blocks are positioned by elapsed minutes.
 */
export function CalendarGrid({
  columns,
  range,
  zoom,
  canMove,
  canCreate,
  onSlot,
  onOpen,
  onMove,
  onTimeOff,
  onBlock,
}: {
  columns: GridColumn[];
  range: { from: number; to: number };
  zoom: 10 | 15 | 30;
  canMove: (b: BookingCard) => boolean;
  canCreate: (col: GridColumn) => boolean;
  onSlot: (col: GridColumn, offset: number) => void;
  onOpen: (b: BookingCard) => void;
  onMove: (b: BookingCard, col: GridColumn, offset: number) => void;
  onTimeOff: (col: GridColumn, t: CalTimeOff) => void;
  onBlock?: (col: GridColumn) => void;
}) {
  const ppm = ROW_PX / zoom;
  const height = (range.to - range.from) * ppm;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // drag-to-move (desktop / tablet pointer)
  const drag = useRef<{
    b: BookingCard;
    x: number;
    y: number;
    grabOffset: number;
    moved: boolean;
  } | null>(null);
  const [ghost, setGhost] = useState<{ key: string; top: number; h: number; label: string } | null>(
    null,
  );
  const colRefs = useRef(new Map<string, HTMLDivElement>());

  const target = (clientX: number, clientY: number, grabOffset: number) => {
    for (const col of columns) {
      const el = colRefs.current.get(col.key);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        const raw = range.from + (clientY - r.top) / ppm - grabOffset;
        const snapped = Math.round(raw / 5) * 5;
        return { col, offset: Math.max(range.from, Math.min(range.to - 5, snapped)) };
      }
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent, b: BookingCard, col: GridColumn) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drag.current = {
      b,
      x: e.clientX,
      y: e.clientY,
      grabOffset: (e.clientY - r.top) / ppm,
      moved: false,
    };
    if (canMove(b)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    void col;
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !canMove(d.b)) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true;
    const t = target(e.clientX, e.clientY, d.grabOffset);
    if (!t) return;
    const h = (Date.parse(d.b.ends_at) - Date.parse(d.b.starts_at)) / 60000;
    setGhost({
      key: t.col.key,
      top: (t.offset - range.from) * ppm,
      h: h * ppm,
      label: timeLabel(isoAt(t.col.frame, t.offset)),
    });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setGhost(null);
    if (!d) return;
    if (!d.moved) return onOpen(d.b);
    const t = target(e.clientX, e.clientY, d.grabOffset);
    if (t) onMove(d.b, t.col, t.offset);
  };

  return (
    <div className="flex min-w-0 flex-1 overflow-auto" data-testid="calendar-grid">
      {/* hour gutter */}
      <div className="sticky left-0 z-10 w-14 shrink-0 bg-surface-0">
        <div className="h-14 border-b border-line-200" />
        <div className="relative" style={{ height }}>
          {columns[0]
            ? hourMarks(columns[0].frame, range.from, range.to).map((h) => (
                <span
                  key={h.offset}
                  className="absolute right-2 -translate-y-1/2 text-[11px] text-ink-500"
                  style={{ top: (h.offset - range.from) * ppm }}
                >
                  {h.label}
                </span>
              ))
            : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {columns.map((col) => {
          const items = col.items.filter((i) => overlapsDay(col.frame, i.starts_at, i.ends_at));
          const nowOffset =
            now >= Date.parse(col.frame.startIso) && now < Date.parse(col.frame.endIso)
              ? offsetIn(col.frame, new Date(now).toISOString())
              : null;
          return (
            <div key={col.key} className="min-w-[9.5rem] flex-1 border-l border-line-200">
              <div className="sticky top-0 z-10 flex h-14 flex-col justify-center border-b border-line-200 bg-surface-0 px-2">
                <span className="flex items-center justify-between gap-1">
                  {col.href ? (
                    <a href={col.href} className="truncate text-sm font-semibold hover:underline">
                      {col.title}
                    </a>
                  ) : (
                    <span className="truncate text-sm font-semibold">{col.title}</span>
                  )}
                  {onBlock && canCreate(col) ? (
                    <button
                      type="button"
                      className="shrink-0 text-[11px] font-medium text-accent-600 hover:underline"
                      aria-label={`Block time for ${col.title}`}
                      onClick={() => onBlock(col)}
                    >
                      Block
                    </button>
                  ) : null}
                </span>
                {col.subtitle ? (
                  <span className="truncate text-[11px] text-ink-500">{col.subtitle}</span>
                ) : null}
              </div>
              <div
                ref={(el) => {
                  if (el) colRefs.current.set(col.key, el);
                  else colRefs.current.delete(col.key);
                }}
                className="relative cursor-cell"
                style={{ height }}
                data-testid={`col-${col.key}`}
                data-from={range.from}
                data-ppm={ppm}
                onClick={(e) => {
                  if (!canCreate(col)) return;
                  const r = e.currentTarget.getBoundingClientRect();
                  const raw = range.from + (e.clientY - r.top) / ppm;
                  onSlot(col, Math.floor(raw / zoom) * zoom);
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {/* row lines */}
                {Array.from({ length: Math.ceil((range.to - range.from) / zoom) }, (_, i) => (
                  <div
                    key={i}
                    className={`pointer-events-none absolute inset-x-0 border-t ${(range.from + i * zoom) % 60 === 0 ? 'border-line-200' : 'border-line-200/40'}`}
                    style={{ top: i * ROW_PX }}
                  />
                ))}
                {/* non-working time */}
                {offShift(col.frame, col.staff.working, range.from, range.to).map(([a, b]) => (
                  <div
                    key={a}
                    className="pointer-events-none absolute inset-x-0 bg-[repeating-linear-gradient(135deg,var(--color-surface-100)_0_6px,transparent_6px_12px)]"
                    style={{ top: (a - range.from) * ppm, height: (b - a) * ppm }}
                    data-testid="off-shift"
                  />
                ))}
                {/* time off / blocked time */}
                {col.staff.time_off
                  .filter((t) => overlapsDay(col.frame, t.start, t.end))
                  .map((t) => {
                    const a = Math.max(range.from, offsetIn(col.frame, t.start));
                    const b = Math.min(range.to, offsetIn(col.frame, t.end));
                    if (b <= a) return null;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        data-testid="time-off"
                        className="absolute inset-x-1 overflow-hidden rounded bg-ink-500/15 px-1.5 text-start text-[11px] text-ink-700"
                        style={{ top: (a - range.from) * ppm, height: (b - a) * ppm }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTimeOff(col, t);
                        }}
                      >
                        {TIME_OFF_LABEL[t.kind]}
                        {t.reason ? ` · ${t.reason}` : ''}
                      </button>
                    );
                  })}
                {/* appointments */}
                {placeLanes(items).map(({ item: b, lane, lanes }) => {
                  const a = offsetIn(col.frame, b.starts_at);
                  const e = offsetIn(col.frame, b.ends_at);
                  const h = Math.max((e - a) * ppm, 14);
                  const compact = h < 34;
                  return (
                    <button
                      key={b.item_id}
                      type="button"
                      data-testid="appt"
                      data-booking-id={b.booking_id}
                      data-status={b.status}
                      aria-label={blockLabel(b)}
                      className={`absolute overflow-hidden rounded px-1.5 py-0.5 text-start text-xs shadow-sm ${blockClass(b)} ${canMove(b) ? 'cursor-grab touch-none' : ''}`}
                      style={{
                        top: (a - range.from) * ppm,
                        height: h,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                      }}
                      onClick={(ev) => ev.stopPropagation()}
                      onPointerDown={(ev) => onPointerDown(ev, b, col)}
                      onPointerUp={(ev) => {
                        ev.stopPropagation();
                        onPointerUp(ev);
                      }}
                      onPointerMove={onPointerMove}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          onOpen(b);
                        }
                      }}
                    >
                      <span
                        className={`flex items-center gap-1 font-semibold ${compact ? 'truncate' : ''}`}
                      >
                        {b.requested ? (
                          <span className="text-star-500" title="Requested">
                            ★
                          </span>
                        ) : null}
                        <span className="truncate">
                          {b.customer?.name ??
                            (b.status === 'held' ? 'Booking online…' : 'Walk-in')}
                        </span>
                        {b.customer?.is_new ? (
                          <span className="rounded bg-info-600 px-1 text-[10px] font-medium text-white">
                            New
                          </span>
                        ) : null}
                        {b.customer?.reliability === 'some_missed_appointments' ? (
                          <span title="Some missed appointments">⚠</span>
                        ) : null}
                        {b.internal_note || b.customer?.pinned_note ? (
                          <span title="Note">📝</span>
                        ) : null}
                        <span className="ms-auto shrink-0 opacity-70" title={b.source}>
                          {SOURCE_ICON[b.source] ?? ''}
                        </span>
                      </span>
                      {!compact ? (
                        <span className="block truncate">
                          {timeLabel(b.starts_at)} · {b.service_name}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {ghost?.key === col.key ? (
                  <div
                    className="pointer-events-none absolute inset-x-1 rounded border-2 border-accent-600 bg-accent-600/20 px-1 text-xs font-semibold"
                    style={{ top: ghost.top, height: ghost.h }}
                  >
                    {ghost.label}
                  </div>
                ) : null}
                {nowOffset !== null && nowOffset >= range.from && nowOffset <= range.to ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-danger-600"
                    data-testid="now-line"
                    style={{ top: (nowOffset - range.from) * ppm }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
