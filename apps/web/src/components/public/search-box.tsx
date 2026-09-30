'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconClock, IconPin, IconSearch } from '@/components/customer/icons';
import { supabase } from '@/lib/supabase';

// C3 search: typed suggestions (services with places nearby · businesses · areas), recents (device only),
// keyboard navigation (↑ ↓ Enter Esc). Submitting free text goes to results; a business opens its page.

interface Suggest {
  services: { id: string; name: string; places: number }[];
  businesses: { slug: string; name: string; area: string | null; display_rating: number | null }[];
  areas: { id: string; slug: string; name: string }[];
}
type Item =
  | { kind: 'service'; label: string; hint: string; href: string }
  | { kind: 'business'; label: string; hint: string; href: string }
  | { kind: 'area'; label: string; hint: string; href: string }
  | { kind: 'recent'; label: string; hint: string; href: string };

const RECENTS = 'search:recents';
const readRecents = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENTS) ?? '[]') as string[];
  } catch {
    return [];
  }
};
const saveRecent = (q: string) => {
  try {
    localStorage.setItem(
      RECENTS,
      JSON.stringify([q, ...readRecents().filter((x) => x !== q)].slice(0, 8)),
    );
  } catch {
    /* private mode: recents are a convenience */
  }
};

export function SearchBox({
  cluster,
  initial = '',
  big = false,
}: {
  cluster?: string | null;
  initial?: string;
  big?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [sug, setSug] = useState<Suggest | null>(null);
  const [active, setActive] = useState(-1);
  const [recents, setRecents] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const withCluster = (params: URLSearchParams) => {
    if (cluster) params.set('cluster', cluster);
    return params.toString();
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let alive = true;
    const t = window.setTimeout(() => {
      void supabase()
        .rpc('search_suggest', { p_q: term, p_cluster_id: cluster ?? undefined })
        .then(({ data }) => {
          if (alive) setSug((data as unknown as Suggest) ?? null);
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, cluster]);

  // hydrated: typing before this would be lost (tests wait for data-ready)
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const items: Item[] = useMemo(() => {
    if (q.trim().length < 2 || !sug) {
      return recents.map((r) => ({
        kind: 'recent',
        label: r,
        hint: 'Recent',
        href: `/search?${withCluster(new URLSearchParams({ q: r }))}`,
      }));
    }
    return [
      ...sug.services.map((s) => ({
        kind: 'service' as const,
        label: s.name,
        hint: s.places ? `${s.places} place${s.places === 1 ? '' : 's'}` : 'Service',
        href: `/search?${withCluster(new URLSearchParams({ q: s.name, service: s.id }))}`,
      })),
      ...sug.businesses.map((b) => ({
        kind: 'business' as const,
        label: b.name,
        hint: [b.area, b.display_rating ? `★ ${b.display_rating}` : null]
          .filter(Boolean)
          .join(' · '),
        href: `/${b.slug}`,
      })),
      ...sug.areas.map((a) => ({
        kind: 'area' as const,
        label: a.name,
        hint: 'Area',
        href: `/search?${new URLSearchParams({ area: a.id }).toString()}`,
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- withCluster only depends on cluster
  }, [q, sug, recents, cluster]);

  const go = (href: string, label?: string) => {
    if (label) saveRecent(label);
    setOpen(false);
    router.push(href);
  };
  const submit = () => {
    const term = q.trim();
    if (!term) return;
    go(`/search?${withCluster(new URLSearchParams({ q: term }))}`, term);
  };

  const showEmpty = open && q.trim().length >= 2 && sug && items.length === 0;
  return (
    <div className="relative w-full" ref={box} data-testid="search-box" data-ready={ready}>
      <form
        className="relative"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && items[active])
            go(
              items[active].href,
              items[active].kind === 'business' ? undefined : items[active].label,
            );
          else submit();
        }}
      >
        <IconSearch
          size={big ? 22 : 18}
          className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ink-700"
        />
        <input
          className={`w-full rounded-full border border-line-200 bg-surface-0 pe-4 shadow-sm outline-none placeholder:text-ink-500 focus:border-accent-600 ${big ? 'h-14 ps-12 text-base sm:text-lg' : 'h-11 ps-11 text-sm'}`}
          type="search"
          value={q}
          placeholder="Search services or businesses"
          aria-label="Search services or businesses"
          dir="auto"
          autoComplete="off"
          onFocus={() => {
            setRecents(readRecents());
            setOpen(true);
          }}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
            setOpen(true);
            if (e.target.value.trim().length < 2) setSug(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Escape') setOpen(false);
          }}
          data-testid="search-input"
        />
      </form>
      {open && (items.length > 0 || showEmpty) ? (
        <ul
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-card border border-line-200 bg-surface-0 py-1 shadow-lg"
          role="listbox"
          data-testid="suggestions"
        >
          {showEmpty ? (
            <li className="px-4 py-2 text-sm text-ink-700">
              No exact matches for “{q.trim()}”. Try “haircut”, “nails” or “massage” — or press
              Enter to search anyway.
            </li>
          ) : null}
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.href}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-start text-sm ${i === active ? 'bg-accent-50' : 'hover:bg-surface-50'}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(it.href, it.kind === 'business' ? undefined : it.label)}
                data-testid={`suggestion-${it.kind}`}
              >
                <span className="text-ink-500">
                  {it.kind === 'area' ? (
                    <IconPin size={16} />
                  ) : it.kind === 'recent' ? (
                    <IconClock size={16} />
                  ) : (
                    <IconSearch size={16} />
                  )}
                </span>
                <span className="flex-1" dir="auto">
                  {it.label}
                </span>
                <span className="text-xs text-ink-500">{it.hint}</span>
              </button>
            </li>
          ))}
          {items.length && items[0]?.kind === 'recent' ? (
            <li>
              <button
                type="button"
                className="w-full px-4 py-2 text-start text-xs text-ink-500 hover:underline"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  try {
                    localStorage.removeItem(RECENTS);
                  } catch {
                    /* ignore */
                  }
                  setRecents([]);
                }}
              >
                Clear recent searches
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
