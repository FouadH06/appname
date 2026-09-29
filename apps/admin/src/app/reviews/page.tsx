'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { Database } from '@app/db';
import { Badge, Shell, State, Table, field, fmt, statusTone, useData } from '@/components/ui';
import { REVIEW_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A6 Reviews: platform-wide search with trust metadata → detail.

type ReviewStatus = Database['public']['Enums']['review_status'];
type RatingState = Database['public']['Enums']['rating_state'];
interface Row {
  id: string;
  created_at: string;
  overall: number;
  trust_tier: string;
  base_weight: number;
  fraud_multiplier: number;
  status: ReviewStatus;
  rating_state: RatingState;
  text_state: string | null;
  snippet: string | null;
  business: string;
  author: string | null;
}

function Reviews() {
  const access = useAdminGate(REVIEW_ROLES);
  const business = useSearchParams().get('business');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [rating, setRating] = useState<RatingState | ''>('');
  const [stars, setStars] = useState('');
  const { data, error, loading } = useData<Row[]>(
    () =>
      supabase().rpc('admin_list_reviews', {
        p_business_id: business ?? undefined,
        p_status: status || undefined,
        p_rating_state: rating || undefined,
        p_stars: stars ? Number(stars) : undefined,
        p_q: q.trim() || undefined,
      }),
    [business, status, rating, stars, q],
  );
  if (!access) return null;
  return (
    <Shell access={access} title="Reviews">
      <div className="flex gap-2">
        <input
          className={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Business or text"
          aria-label="Search reviews"
        />
        <select
          className={field + ' max-w-40'}
          value={status}
          onChange={(e) => setStatus(e.target.value as ReviewStatus | '')}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {['published', 'pending', 'removed', 'deleted_by_author'].map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          className={field + ' max-w-40'}
          value={rating}
          onChange={(e) => setRating(e.target.value as RatingState | '')}
          aria-label="Rating state"
        >
          <option value="">Any rating state</option>
          {['active', 'pending_check', 'quarantined', 'removed'].map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select
          className={field + ' max-w-28'}
          value={stars}
          onChange={(e) => setStars(e.target.value)}
          aria-label="Stars"
        >
          <option value="">Any ★</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n}★
            </option>
          ))}
        </select>
      </div>
      <State
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="No reviews match."
      />
      {data?.length ? (
        <Table
          rows={data}
          testId="reviews"
          href={(r) => `/reviews/${r.id}`}
          cols={[
            ['Date', (r) => fmt(r.created_at, false)],
            ['Business', (r) => r.business],
            ['Author', (r) => r.author ?? '—'],
            ['Stars', (r) => '★'.repeat(r.overall)],
            ['Tier', (r) => r.trust_tier.replace('_', ' ')],
            ['Weight', (r) => `${r.base_weight} × ${r.fraud_multiplier}`],
            [
              'Status',
              (r) => (
                <Badge tone={statusTone(r.rating_state)}>
                  {r.status} · {r.rating_state.replace('_', ' ')}
                </Badge>
              ),
            ],
            [
              'Comment',
              (r) => (
                <span className="line-clamp-2 text-ink-700" dir="auto">
                  {r.snippet ?? '—'}
                </span>
              ),
            ],
          ]}
        />
      ) : null}
    </Shell>
  );
}

export default function ReviewsPage() {
  return (
    <Suspense>
      <Reviews />
    </Suspense>
  );
}
