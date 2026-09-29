'use client';

import { useState } from 'react';
import { Notice, btn, codeOf } from '@/components/biz/ui';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { ugcUrl } from '@/lib/public/format';
import type { PublicResult } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';

// B10 · Customer photos: feature up to 6 approved results (labeled "Featured by {Business}" on the
// page). Businesses can't hide, delete or reorder organic results — there is no control for it.

type Row = PublicResult & { minor_flag: boolean };

export function ResultsFeaturing({ businessId }: { businessId: string }) {
  const [error, setError] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const { data: d, error: e } = await supabase().rpc('biz_get_results', {
      p_business_id: businessId,
    });
    if (e) return { error: describeError(codeOf(e)) };
    return { rows: (d as unknown as Row[]) ?? [] };
  }, [businessId]);

  const rows: Row[] = data && 'rows' in data ? (data.rows ?? []) : [];
  const taken = new Set(rows.filter((r) => r.is_featured).map((r) => r.featured_rank));
  const firstFree = [1, 2, 3, 4, 5, 6].find((n) => !taken.has(n)) ?? 6;

  const feature = async (r: Row, rank: number) => {
    setError(null);
    const { error: e } = await supabase().rpc('feature_result', {
      p_review_media_id: r.id,
      p_rank: rank,
    });
    if (e) return setError(describeError(codeOf(e)));
    void reload();
  };
  const unfeature = async (r: Row) => {
    const { error: e } = await supabase().rpc('unfeature_result', { p_review_media_id: r.id });
    if (e) return setError(describeError(codeOf(e)));
    void reload();
  };

  if (!data) return <p className="text-sm text-ink-500">Loading…</p>;
  if ('error' in data) return <Notice tone="danger">{data.error}</Notice>;
  return (
    <div className="flex flex-col gap-3" data-testid="results-featuring">
      <Notice>
        Feature up to 6 customer photos at the top of your results (shown as “Featured by” your
        business). Other photos stay in the order the platform chooses; they can’t be hidden.
      </Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {data.rows.length === 0 ? (
        <p className="text-sm text-ink-700" data-testid="no-results">
          No customer photos yet. Customers can add photos to their review after a completed visit.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 rounded-card border border-line-200 bg-surface-0 p-2"
              data-testid="biz-result"
            >
              <div className="relative aspect-square overflow-hidden rounded-control bg-surface-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- public derivative */}
                <img
                  src={ugcUrl(r.images.thumb.path) ?? ''}
                  alt=""
                  className="h-full w-full object-cover"
                />
                {r.is_featured ? (
                  <span className="absolute start-1 top-1 rounded-full bg-accent-600 px-2 py-0.5 text-xs text-white">
                    Featured #{r.featured_rank}
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-ink-700">
                {r.service}
                {r.staff ? ` · ${r.staff}` : ''}
              </p>
              {r.minor_flag ? (
                <p className="text-xs text-ink-500">Can’t be featured (shows a minor)</p>
              ) : r.is_featured ? (
                <button type="button" className={btn.secondary} onClick={() => void unfeature(r)}>
                  Unfeature
                </button>
              ) : (
                <div className="flex gap-1">
                  <select
                    className="h-10 rounded-control border border-line-200 px-2 text-sm"
                    defaultValue={firstFree}
                    aria-label="Featured slot"
                    id={`slot-${r.id}`}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        #{n}
                        {taken.has(n) ? ' (replace)' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={btn.primary}
                    data-testid="feature"
                    onClick={() =>
                      void feature(
                        r,
                        Number(
                          (document.getElementById(`slot-${r.id}`) as HTMLSelectElement).value,
                        ),
                      )
                    }
                  >
                    Feature
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
