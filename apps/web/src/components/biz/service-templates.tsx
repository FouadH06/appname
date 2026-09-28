'use client';

import { useState } from 'react';
import type { Canonical } from '@/lib/biz/data';
import { btn, input } from './ui';

export interface TemplatePick {
  canonical: Canonical;
  price: number;
  duration: number;
}

/**
 * "Start from templates" (Phase 2 B1 step 5): check common services for the category, enter a
 * price, keep or adjust the typical duration. Target: 10 services in ~3 minutes.
 */
export function ServiceTemplatePicker({
  canonical,
  existingCanonicalIds,
  onCreate,
  busy,
}: {
  canonical: Canonical[];
  existingCanonicalIds: string[];
  onCreate: (picks: TemplatePick[]) => void;
  busy?: boolean;
}) {
  const options = canonical.filter(
    (c) => !c.slug.startsWith('other-') && !existingCanonicalIds.includes(c.id),
  );
  const [picked, setPicked] = useState<Record<string, { price: string; duration: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    const picks: TemplatePick[] = [];
    for (const c of options) {
      const p = picked[c.id];
      if (!p) continue;
      const price = Number(p.price);
      if (p.price === '' || Number.isNaN(price) || price < 0) {
        setError(`Enter a price for ${c.name_en}.`);
        return;
      }
      picks.push({ canonical: c, price, duration: p.duration });
    }
    if (!picks.length) {
      setError('Pick at least one service.');
      return;
    }
    setError(null);
    onCreate(picks);
    setPicked({});
  };

  if (!options.length)
    return <p className="text-sm text-ink-500">All common services for your category are added.</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="service-templates">
      <ul className="flex flex-col divide-y divide-line-200 rounded-control border border-line-200">
        {options.map((c) => {
          const p = picked[c.id];
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <label className="flex min-w-40 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!p}
                  onChange={(e) =>
                    setPicked((all) => {
                      const next = { ...all };
                      if (e.target.checked)
                        next[c.id] = { price: '', duration: c.typical_duration_min ?? 30 };
                      else delete next[c.id];
                      return next;
                    })
                  }
                />
                {c.name_en}
              </label>
              {p ? (
                <>
                  <input
                    className={input + ' w-24'}
                    inputMode="decimal"
                    placeholder="$"
                    aria-label={`${c.name_en} price`}
                    value={p.price}
                    onChange={(e) =>
                      setPicked((all) => ({ ...all, [c.id]: { ...p, price: e.target.value } }))
                    }
                  />
                  <input
                    className={input + ' w-24'}
                    type="number"
                    min={5}
                    step={5}
                    aria-label={`${c.name_en} minutes`}
                    value={p.duration}
                    onChange={(e) =>
                      setPicked((all) => ({
                        ...all,
                        [c.id]: { ...p, duration: Number(e.target.value) },
                      }))
                    }
                  />
                  <span className="text-ink-500">min</span>
                </>
              ) : (
                <span className="text-ink-500">{c.typical_duration_min ?? 30} min</span>
              )}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={btn.primary + ' self-start'}
        disabled={busy}
        onClick={create}
      >
        Add {Object.keys(picked).length || ''} services
      </button>
    </div>
  );
}
