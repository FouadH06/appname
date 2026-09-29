'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { primaryButton, secondaryButton } from '@/components/card';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { ResultUploader } from './result-uploader';
import { TIER_LABEL } from '@/lib/public/format';

// C15 Write a review (Phase 2 C15; Part 4 §1.3). Stars are required and published right away; the
// comment is optional and appears after the automatic check. One edit within 7 days.

interface ReviewContext {
  booking_id: string;
  eligible: boolean;
  reason: string | null;
  trust_tier: 'verified_booking' | 'verified_visit' | null;
  visit_at: string;
  business: { name: string; slug: string };
  service: string | null;
  staff_first_name: string | null;
  dimensions: { key: string; label_en: string; label_ar: string }[];
  review: {
    id: string;
    overall: number;
    text: string | null;
    status: string;
    rating_state: string;
    text_state: string | null;
    can_edit: boolean;
    ratings: Record<string, number>;
  } | null;
}

const MIN = 20;
const MAX = 2000;
const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

/** A random id kept on this device (fraud pre-check: several accounts reviewing from one phone). */
function deviceId(): string | null {
  try {
    let v = localStorage.getItem('app.device');
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem('app.device', v);
    }
    return v;
  } catch {
    return null;
  }
}

function StarInput({
  value,
  onChange,
  label,
  size = 'lg',
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  size?: 'lg' | 'sm';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          className={`${size === 'lg' ? 'h-12 w-12 text-4xl' : 'h-9 w-9 text-2xl'} leading-none ${
            n <= value ? 'text-warning-600' : 'text-line-200'
          }`}
          onClick={() => onChange(n)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const visitText = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Beirut',
  }).format(new Date(iso));

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [overall, setOverall] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text_state: string | null; rating_state: string } | null>(
    null,
  );
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const load = () =>
    supabase()
      .rpc('get_review_context', { p_booking_id: bookingId })
      .then(({ data, error: e }) => {
        if (e) return setError(describeError(e.message));
        setCtx(data as unknown as ReviewContext);
      });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per booking
  }, [bookingId]);

  const startEdit = () => {
    const r = ctx?.review;
    if (!r) return;
    setOverall(r.overall);
    setRatings(r.ratings);
    setText(r.text ?? '');
    setEditing(true);
  };

  const trimmed = text.trim();
  const textOk = trimmed.length === 0 || (trimmed.length >= MIN && trimmed.length <= MAX);
  // a gentle hint: numbers and names don't belong in reviews (they'd be removed anyway)
  const looksLikePhone = /(?:\+?961|\b0?[37]\d)[\s.-]?\d{3}[\s.-]?\d{3}/.test(
    trimmed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)),
  );

  const submit = async () => {
    if (!ctx || overall < 1 || !textOk) return;
    setBusy(true);
    setError(null);
    const { data, error: e } =
      editing && ctx.review
        ? await supabase().rpc('edit_my_review', {
            p_review_id: ctx.review.id,
            p_overall: overall,
            p_ratings: ratings,
            p_text: trimmed || undefined,
          })
        : await supabase().rpc('submit_review', {
            p_booking_id: ctx.booking_id,
            p_overall: overall,
            p_ratings: ratings,
            p_text: trimmed || undefined,
            p_device_hash: deviceId() ?? undefined,
            p_idempotency_key: idempotencyKey,
          });
    setBusy(false);
    if (e) return setError(describeError(e.message));
    const r = data as { text_state: string | null; rating_state: string };
    setDone(r);
    setEditing(false);
    void load();
  };

  const remove = async () => {
    if (!ctx?.review || !window.confirm('Delete your review? This can’t be undone.')) return;
    setBusy(true);
    const { error: e } = await supabase().rpc('delete_my_review', { p_review_id: ctx.review.id });
    setBusy(false);
    if (e) return setError(describeError(e.message));
    setDone(null);
    void load();
  };

  if (!ctx) {
    return error ? (
      <p className="text-sm text-danger-600" role="alert">
        {error}
      </p>
    ) : (
      <p className="text-sm text-ink-500">Loading…</p>
    );
  }

  const header = (
    <div className="rounded-control bg-surface-50 p-3 text-sm" data-testid="review-visit">
      <div className="font-medium text-ink-900">{ctx.business.name}</div>
      <div className="text-ink-700">
        {ctx.service}
        {ctx.staff_first_name ? ` · with ${ctx.staff_first_name}` : ''} · {visitText(ctx.visit_at)}
      </div>
      {ctx.trust_tier ? (
        <div className="mt-1 text-xs font-medium text-success-600">
          ✓ {TIER_LABEL[ctx.trust_tier]}
        </div>
      ) : null}
    </div>
  );

  // ── thank-you / existing review ──
  if (ctx.review && !editing) {
    const r = ctx.review;
    const deleted = r.status === 'deleted_by_author';
    return (
      <div className="flex flex-col gap-4" data-testid="review-status">
        {header}
        {done ? (
          <p className="font-medium text-ink-900" data-testid="review-thanks">
            Thanks! Your rating is live.
            {done.text_state === 'pending' ? ' Your comment will appear after a quick check.' : ''}
          </p>
        ) : null}
        {deleted ? (
          <p className="text-sm text-ink-700">You deleted this review.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl text-warning-600">{'★'.repeat(r.overall)}</span>
              <span className="text-sm text-ink-500">{STAR_WORDS[r.overall]}</span>
            </div>
            {r.text ? (
              <p className="whitespace-pre-line text-sm text-ink-900" dir="auto">
                {r.text}
              </p>
            ) : null}
            <p className="text-sm text-ink-700" data-testid="review-state">
              {r.rating_state === 'quarantined'
                ? 'Your review is being checked by our team.'
                : r.text_state === 'pending'
                  ? 'Rating published · comment being checked'
                  : r.text_state === 'rejected' || r.text_state === 'removed'
                    ? 'Rating published · your comment couldn’t be published as written.'
                    : r.text_state === 'manual_review'
                      ? 'Rating published · comment waiting for a moderator'
                      : 'Published'}
            </p>
            {r.status !== 'removed' ? (
              <ResultUploader reviewId={r.id} service={ctx.service ?? ''} />
            ) : null}
            {r.can_edit ? (
              <button
                type="button"
                className={secondaryButton}
                onClick={startEdit}
                data-testid="edit-review"
              >
                Edit review (once, within 7 days)
              </button>
            ) : null}
            <button
              type="button"
              className="text-sm text-danger-600"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete review
            </button>
          </>
        )}
        <Link href={`/${ctx.business.slug}`} className="text-sm font-medium text-accent-600">
          Back to {ctx.business.name}
        </Link>
        {error ? (
          <p className="text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (!ctx.eligible && !editing) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-ink-700" data-testid="review-not-eligible">
          {describeError(ctx.reason ?? 'NOT_ELIGIBLE')}
        </p>
      </div>
    );
  }

  // ── form ──
  return (
    <form
      className="flex flex-col gap-5"
      data-testid="review-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {header}
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-ink-900">How was your visit?</legend>
        <StarInput value={overall} onChange={setOverall} label="Overall rating" />
        <span className="h-5 text-sm text-ink-500">{STAR_WORDS[overall]}</span>
      </fieldset>

      {overall > 0 && ctx.dimensions.length ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink-900">
            Rate the details <span className="font-normal text-ink-500">(optional)</span>
          </legend>
          {ctx.dimensions.map((d) => (
            <div key={d.key} className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-700">{d.label_en}</span>
              <StarInput
                size="sm"
                label={d.label_en}
                value={ratings[d.key] ?? 0}
                onChange={(v) => setRatings((x) => ({ ...x, [d.key]: v }))}
              />
            </div>
          ))}
        </fieldset>
      ) : null}

      {overall > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink-900">
            Tell others about it <span className="font-normal text-ink-500">(optional)</span>
          </span>
          <textarea
            className="min-h-28 rounded-control border border-line-200 p-3 text-base"
            dir="auto"
            maxLength={MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What went well? What could be better?"
            aria-describedby="review-text-hint"
          />
          <span id="review-text-hint" className="text-xs text-ink-500">
            {trimmed.length > 0 && trimmed.length < MIN
              ? `${MIN - trimmed.length} more characters`
              : 'Any language is fine. Don’t include phone numbers or other people’s full names.'}
          </span>
          {looksLikePhone ? (
            <span className="text-xs text-warning-600" data-testid="phone-hint">
              Phone numbers are removed before a review is published.
            </span>
          ) : null}
        </label>
      ) : null}

      <button
        type="submit"
        className={primaryButton}
        disabled={busy || overall < 1 || !textOk}
        data-testid="submit-review"
      >
        {busy ? 'Sending…' : editing ? 'Save changes' : 'Post review'}
      </button>
      {editing ? (
        <button type="button" className={secondaryButton} onClick={() => setEditing(false)}>
          Cancel
        </button>
      ) : null}
      <p className="text-xs text-ink-500">
        Your first name and last initial are shown. The business can reply but can’t remove your
        review.
      </p>
      {error ? (
        <p className="text-sm text-danger-600" role="alert" data-testid="review-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
