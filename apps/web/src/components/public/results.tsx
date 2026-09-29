'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ugcUrl } from '@/lib/public/format';
import type { BusinessResults, PublicResult } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';

// C6 Customer Results: tiles, the business-page strip, and the grid (featured row labeled, organic
// feed ordered by the platform — never by the business).

const monthText = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Beirut',
  }).format(new Date(iso));

export function ResultTile({
  r,
  size = 'thumb',
  eager = false,
}: {
  r: PublicResult;
  size?: 'thumb' | 'card';
  eager?: boolean;
}) {
  const img = r.images[size] ?? r.images.thumb;
  return (
    <Link
      href={`/r/${r.id}`}
      className="group relative block aspect-square overflow-hidden rounded-control bg-surface-100"
      data-testid="result-tile"
      aria-label={`${r.service ?? 'Result'}${r.staff ? ` by ${r.staff}` : ''}, ${monthText(r.visit_at)}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pre-sized public derivatives */}
      <img
        src={ugcUrl(img.path) ?? ''}
        width={img.width}
        height={img.height}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
      />
      <span className="absolute bottom-1 start-1 rounded-full bg-ink-900/70 px-2 py-0.5 text-[11px] text-white">
        ✓ {r.service}
      </span>
    </Link>
  );
}

/** C1 strip: featured first (labeled), then organic; "See all" opens the grid. */
export function ResultsStrip({
  slug,
  businessName,
  data,
}: {
  slug: string;
  businessName: string;
  data: BusinessResults;
}) {
  const featuredIds = new Set(data.featured.map((f) => f.id));
  const tiles = [...data.featured, ...data.items.filter((i) => !featuredIds.has(i.id))].slice(0, 8);
  if (!tiles.length) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="results-strip">
      {data.featured.length ? (
        <p className="text-xs text-ink-500">Featured by {businessName}</p>
      ) : null}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {tiles.map((r, i) => (
          <div key={r.id} className="w-28 shrink-0 sm:w-32">
            <ResultTile r={r} eager={i < 3} />
          </div>
        ))}
      </div>
      <Link href={`/${slug}/results`} className="text-sm font-medium text-accent-600">
        See all {data.total} results
      </Link>
    </div>
  );
}

export function ResultsGrid({
  businessId,
  businessName,
  initial,
  services,
}: {
  businessId: string;
  businessName: string;
  initial: BusinessResults;
  services: { id: string; name: string }[];
}) {
  const [service, setService] = useState<string | null>(null);
  const [data, setData] = useState(initial);
  const [more, setMore] = useState(initial.items.length === 24);
  const [busy, setBusy] = useState(false);

  const fetchPage = async (svc: string | null, before?: string) => {
    const { data: d } = await supabase().rpc('get_business_results', {
      p_business_id: businessId,
      p_service_id: svc ?? undefined,
      p_before: before,
      p_limit: 24,
    });
    return (d as unknown as BusinessResults | null) ?? { featured: [], items: [], total: 0 };
  };
  const pick = async (svc: string | null) => {
    setService(svc);
    setBusy(true);
    const d = svc ? await fetchPage(svc) : initial;
    setData(d);
    setMore(d.items.length === 24);
    setBusy(false);
  };
  const loadMore = async () => {
    setBusy(true);
    const d = await fetchPage(service, data.items[data.items.length - 1]?.published_at);
    setData((x) => ({
      ...x,
      items: [...x.items, ...d.items.filter((n) => !x.items.some((o) => o.id === n.id))],
    }));
    setMore(d.items.length === 24);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {services.length > 1 ? (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4"
          role="tablist"
          aria-label="Filter by service"
        >
          {[{ id: null as string | null, name: 'All' }, ...services].map((s) => (
            <button
              key={s.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={service === s.id}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-sm ${
                service === s.id
                  ? 'border-accent-600 bg-accent-600 text-white'
                  : 'border-line-200 bg-surface-0'
              }`}
              onClick={() => void pick(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      {!service && data.featured.length ? (
        <section className="flex flex-col gap-2" data-testid="featured-results">
          <h2 className="text-sm font-semibold text-ink-700">Featured by {businessName}</h2>
          <div className="grid grid-cols-3 gap-1 md:grid-cols-5">
            {data.featured.map((r, i) => (
              <ResultTile key={r.id} r={r} size="card" eager={i < 6} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-700">All results</h2>
        {data.items.length ? (
          <div className="grid grid-cols-3 gap-1 md:grid-cols-5" data-testid="results-grid">
            {data.items.map((r, i) => (
              <ResultTile key={r.id} r={r} eager={i < 9} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-700">
            {busy ? 'Loading…' : 'No customer results yet. They appear after verified visits.'}
          </p>
        )}
      </section>
      {more ? (
        <button
          type="button"
          className="h-11 rounded-control border border-line-200 text-sm font-medium"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          {busy ? 'Loading…' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}
