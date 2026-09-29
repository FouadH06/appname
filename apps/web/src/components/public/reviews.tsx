'use client';

import { TIER_LABEL } from '@/lib/public/format';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicReview, RatingSummary } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';

// Verified reviews on the business page (C1 §4.6) and the business dashboard (B10). Businesses can
// reply and report, never hide or reorder: newest first, the same list for everyone.

const monthText = (iso: string) =>
  new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'Asia/Beirut' }).format(
    new Date(iso),
  );

export function Stars({ value, className = '' }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span
      className={`text-warning-600 ${className}`}
      aria-label={`${value} out of 5 stars`}
      role="img"
    >
      {'★'.repeat(full)}
      <span className="text-line-200">{'★'.repeat(5 - full)}</span>
    </span>
  );
}

export function RatingHeadline({ rating }: { rating: RatingSummary }) {
  if (rating.display_rating !== null) {
    return (
      <a href="#reviews" className="flex items-center gap-1 text-sm" data-testid="rating-headline">
        <span className="font-semibold text-ink-900">★ {rating.display_rating.toFixed(1)}</span>
        <span className="text-ink-500">
          · {rating.review_count} verified review{rating.review_count === 1 ? '' : 's'}
        </span>
      </a>
    );
  }
  return (
    <p className="text-sm text-ink-500" data-testid="rating-headline">
      {rating.review_count > 0
        ? `New on APP_NAME · ${rating.review_count} verified review${rating.review_count === 1 ? '' : 's'} so far`
        : 'New on APP_NAME — reviews appear after verified visits.'}
    </p>
  );
}

/** Text with an on-demand translation (cached per text and language; the worker fills it). */
export function TranslatableText({
  subjectType,
  id,
  text,
  langs,
  className = '',
}: {
  subjectType: 'review' | 'reply';
  id: string;
  text: string;
  langs: string[];
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'pending' | 'shown' | 'hidden' | 'unavailable'>(
    'idle',
  );
  const [translation, setTranslation] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  // English-first UI: offer a translation for anything not written only in English
  const foreign = langs.length > 0 && langs.some((l) => l !== 'en');

  const request = (tries = 0) => {
    setState('pending');
    void supabase()
      .rpc('request_translation', { p_subject_type: subjectType, p_subject_id: id, p_locale: 'en' })
      .then(({ data, error }) => {
        const r = data as { state: string; text?: string } | null;
        if (error || !r || r.state === 'unavailable') return setState('unavailable');
        if (r.state === 'ready' && r.text) {
          setTranslation(r.text);
          return setState('shown');
        }
        if (tries >= 10) return setState('unavailable');
        timer.current = window.setTimeout(() => request(tries + 1), 3000);
      });
  };

  return (
    <div className={className}>
      <p
        className="whitespace-pre-line text-sm text-ink-900"
        dir="auto"
        data-testid={`${subjectType}-text`}
      >
        {state === 'shown' && translation ? translation : text}
      </p>
      {foreign ? (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-accent-600 disabled:text-ink-500"
          disabled={state === 'pending' || state === 'unavailable'}
          onClick={() =>
            state === 'shown' ? setState('hidden') : translation ? setState('shown') : request()
          }
        >
          {state === 'pending'
            ? 'Translating…'
            : state === 'unavailable'
              ? 'Translation unavailable'
              : state === 'shown'
                ? 'Show original'
                : 'See translation'}
        </button>
      ) : null}
    </div>
  );
}

export function ReviewCard({
  r,
  businessName,
  children,
}: {
  r: PublicReview;
  businessName: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-4" data-testid="review-card" data-review-id={r.id}>
      <div className="flex items-center justify-between gap-2">
        <Stars value={r.overall} />
        <span className="text-xs text-ink-500">{monthText(r.visit_at)}</span>
      </div>
      <p className="text-sm text-ink-700">
        <span className="font-medium text-ink-900">{r.author}</span>
        <span className="ms-2 rounded-full bg-success-600/10 px-2 py-0.5 text-xs font-medium text-success-600">
          ✓ {TIER_LABEL[r.trust_tier]}
        </span>
      </p>
      {r.service ? (
        <p className="text-xs text-ink-500">
          {r.service}
          {r.staff ? ` · with ${r.staff}` : ''}
        </p>
      ) : null}
      {r.text ? (
        <TranslatableText subjectType="review" id={r.id} text={r.text} langs={r.langs} />
      ) : null}
      {r.reply ? (
        <div className="ms-3 border-s-2 border-line-200 ps-3" data-testid="review-reply">
          <p className="text-xs font-medium text-ink-700">Response from {businessName}</p>
          <p className="whitespace-pre-line text-sm text-ink-900" dir="auto">
            {r.reply.text}
          </p>
        </div>
      ) : null}
      {children}
    </li>
  );
}

export function RatingBreakdown({ rating }: { rating: RatingSummary }) {
  if (rating.display_rating === null || !rating.dimensions) return null;
  const dims = Object.entries(rating.dimensions).filter(([, d]) => d.average !== null);
  return (
    <div className="flex flex-col gap-3" data-testid="rating-summary">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold">{rating.display_rating.toFixed(1)}</span>
        <Stars value={rating.display_rating} />
        <span className="text-sm text-ink-500">{rating.review_count} verified reviews</span>
      </div>
      {dims.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {dims.map(([key, d]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <dt className="text-ink-700">{d.label_en}</dt>
              <dd className="flex items-center gap-2">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-100">
                  <span
                    className="block h-full bg-accent-600"
                    style={{ width: `${((d.average ?? 0) / 5) * 100}%` }}
                  />
                </span>
                <span className="w-7 text-end tabular-nums">{d.average?.toFixed(1)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Newest first, 10 at a time. */
export function ReviewList({
  businessId,
  businessName,
  initial,
}: {
  businessId: string;
  businessName: string;
  initial: PublicReview[];
}) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(initial.length === 10);
  const [busy, setBusy] = useState(false);
  const loadMore = async () => {
    setBusy(true);
    const last = items[items.length - 1];
    const { data } = await supabase().rpc('get_business_reviews', {
      p_business_id: businessId,
      p_before: last?.published_at,
      p_limit: 10,
    });
    const next = (data as unknown as PublicReview[] | null) ?? [];
    setItems((xs) => [...xs, ...next.filter((n) => !xs.some((x) => x.id === n.id))]);
    setMore(next.length === 10);
    setBusy(false);
  };
  return (
    <>
      <ul className="flex flex-col divide-y divide-line-200">
        {items.map((r) => (
          <ReviewCard key={r.id} r={r} businessName={businessName} />
        ))}
      </ul>
      {more ? (
        <button
          type="button"
          className="h-11 rounded-control border border-line-200 text-sm font-medium"
          disabled={busy}
          onClick={() => void loadMore()}
        >
          {busy ? 'Loading…' : 'Show more reviews'}
        </button>
      ) : null}
    </>
  );
}
