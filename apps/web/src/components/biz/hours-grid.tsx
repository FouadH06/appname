'use client';

import { WEEKDAYS, fromHHMM, toHHMM, weekErrors, type WeekHours } from '@/lib/biz/time';
import { btn } from './ui';

/**
 * Weekly hours (Phase 2 B1 step 4 / B9 schedule): one or more intervals per day; the gap between
 * intervals is a break; no intervals = closed / day off. "Copy to all" copies Monday's hours.
 */
export function HoursGrid({
  value,
  onChange,
  closedLabel = 'Closed',
  disabled,
}: {
  value: WeekHours;
  onChange: (v: WeekHours) => void;
  closedLabel?: string;
  disabled?: boolean;
}) {
  const errors = weekErrors(value);
  const setDay = (iso: number, list: WeekHours[number]) => onChange({ ...value, [iso]: list });

  return (
    <div className="flex flex-col gap-2" data-testid="hours-grid">
      {WEEKDAYS.map((d) => {
        const list = value[d.iso] ?? [];
        return (
          <div
            key={d.iso}
            className="flex flex-wrap items-start gap-2 border-b border-line-200 py-2 last:border-0"
          >
            <span className="w-12 pt-2 text-sm font-medium">{d.short}</span>
            <div className="flex flex-1 flex-col gap-2">
              {list.length === 0 ? (
                <span className="pt-2 text-sm text-ink-500">{closedLabel}</span>
              ) : null}
              {list.map((iv, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <TimeInput
                    label={`${d.long} start ${idx + 1}`}
                    value={iv.start}
                    disabled={disabled}
                    onChange={(m) =>
                      setDay(
                        d.iso,
                        list.map((x, i) => (i === idx ? { ...x, start: m } : x)),
                      )
                    }
                  />
                  <span className="text-ink-500">–</span>
                  <TimeInput
                    label={`${d.long} end ${idx + 1}`}
                    value={iv.end}
                    disabled={disabled}
                    onChange={(m) =>
                      setDay(
                        d.iso,
                        list.map((x, i) => (i === idx ? { ...x, end: m } : x)),
                      )
                    }
                  />
                  {idx > 0 ? (
                    <span className="text-xs text-ink-500">
                      break {toHHMM(list[idx - 1]!.end)}–{toHHMM(iv.start)}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={btn.link}
                    disabled={disabled}
                    aria-label={`Remove ${d.long} interval ${idx + 1}`}
                    onClick={() =>
                      setDay(
                        d.iso,
                        list.filter((_, i) => i !== idx),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              {errors[d.iso] ? (
                <span className="text-sm text-danger-600" role="alert">
                  {errors[d.iso]}
                </span>
              ) : null}
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                className={btn.link}
                disabled={disabled}
                onClick={() => {
                  const last = list[list.length - 1];
                  // "Open" = a full salon day 9:00–19:00; "+ Shift" adds 4 h after the last shift
                  if (!last) return setDay(d.iso, [{ start: 540, end: 1140 }]);
                  const start = Math.min(last.end + 60, 1380);
                  setDay(d.iso, [...list, { start, end: Math.min(start + 240, 1440) }]);
                }}
              >
                {list.length ? '+ Shift' : 'Open'}
              </button>
              {d.iso === 1 ? (
                <button
                  type="button"
                  className={btn.link}
                  disabled={disabled}
                  onClick={() => {
                    const copy: WeekHours = { ...value };
                    for (const x of WEEKDAYS)
                      if (x.iso !== 1) copy[x.iso] = list.map((iv) => ({ ...iv }));
                    onChange(copy);
                  }}
                >
                  Copy to all
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (m: number) => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="time"
      step={900}
      aria-label={label}
      disabled={disabled}
      value={value >= 1440 ? '23:59' : toHHMM(value)}
      onChange={(e) => {
        const m = fromHHMM(e.target.value);
        if (m !== null) onChange(e.target.value === '23:59' ? 1440 : m);
      }}
      className="h-10 rounded-control border border-line-200 bg-surface-0 px-2 text-sm"
    />
  );
}
