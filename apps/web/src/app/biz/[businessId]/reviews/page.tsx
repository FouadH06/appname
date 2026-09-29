'use client';

import { useState } from 'react';
import { Body, Notice, PageHeader, btn, codeOf, input } from '@/components/biz/ui';
import { ResultsFeaturing } from '@/components/biz/results-featuring';
import { ReviewCard, Stars } from '@/components/public/reviews';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import type { PublicReview, RatingSummary } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';

// B10 Reviews (owner/manager). The same public content plus reply and report. No reviewer phone and
// no link to the customer record (anti-retaliation); reviews can't be hidden, removed or reordered.

type BizReview = PublicReview & {
  my_reply: { text: string; state: string } | null;
  report: { status: string; reason: string; resolution_note: string | null } | null;
};
interface Payload {
  summary: RatingSummary & { response_rate: number | null; needs_reply: number };
  reviews: BizReview[];
}
type Tab = 'needs_reply' | 'all' | 'reported' | 'photos';

const TABS: [Tab, string][] = [
  ['needs_reply', 'Needs reply'],
  ['all', 'All'],
  ['reported', 'Reported'],
  ['photos', 'Customer photos'],
];
const REASONS: [string, string][] = [
  ['abusive_language', 'Abusive or insulting language'],
  ['personal_information', 'Shares personal information'],
  ['never_attended', 'This customer never came'],
  ['harassment', 'Harassment or threats'],
  ['false_information', 'False information'],
  ['spam', 'Spam or advertising'],
  ['other', 'Something else'],
];
const REPORT_STATUS: Record<string, string> = {
  open: 'Report sent',
  in_review: 'Report under review',
  resolved_action: 'Report accepted — action taken',
  resolved_no_action: 'Reviewed — the review stays (it follows the rules)',
  rejected: 'Report declined',
};
const REPLY_STATE: Record<string, string> = {
  pending: 'Your reply is being checked and will appear shortly.',
  manual_review: 'Your reply is waiting for a moderator.',
  rejected: 'Your reply couldn’t be published as written. Edit it and send again.',
  removed: 'Your reply was removed by a moderator.',
};

function ReplyBox({ review, onDone }: { review: BizReview; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(review.my_reply?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await supabase().rpc('reply_to_review', {
      p_review_id: review.id,
      p_text: text.trim(),
    });
    setBusy(false);
    if (e) return setError(describeError(codeOf(e)));
    setOpen(false);
    onDone('Reply sent. It appears under the review after a quick check.');
  };
  const remove = async () => {
    if (!window.confirm('Delete your reply?')) return;
    const { error: e } = await supabase().rpc('delete_reply', { p_review_id: review.id });
    if (e) return setError(describeError(codeOf(e)));
    onDone('Reply deleted.');
  };
  const state = review.my_reply?.state;
  return (
    <div className="flex flex-col gap-2">
      {state && REPLY_STATE[state] ? (
        <p className="text-xs text-ink-500" data-testid="reply-state">
          {REPLY_STATE[state]}
        </p>
      ) : null}
      {open ? (
        <>
          <textarea
            className={`${input} h-24 py-2`}
            dir="auto"
            maxLength={1500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Thank the customer or respond to their feedback. Replies are public."
            aria-label="Reply"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={busy || text.trim().length < 2}
              onClick={() => void send()}
              data-testid="send-reply"
            >
              {busy ? 'Sending…' : 'Post reply'}
            </button>
            <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-3">
          <button
            type="button"
            className={btn.link}
            onClick={() => setOpen(true)}
            data-testid="reply"
          >
            {review.my_reply ? 'Edit reply' : 'Reply'}
          </button>
          {review.my_reply ? (
            <button type="button" className="text-sm text-danger-600" onClick={() => void remove()}>
              Delete reply
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReportSheet({
  review,
  businessId,
  onClose,
}: {
  review: BizReview;
  businessId: string;
  onClose: (sent: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    const { error: e } = await supabase().rpc('report_content', {
      p_subject_type: 'review',
      p_subject_id: review.id,
      p_reason: reason as 'other',
      p_parts: reason === 'never_attended' ? ['whole'] : ['text'],
      p_details: details.trim() || undefined,
      p_as_business_id: businessId,
    });
    setBusy(false);
    if (e) return setError(describeError(codeOf(e)));
    onClose(true);
  };
  return (
    <div
      className="flex flex-col gap-3 rounded-control border border-line-200 bg-surface-50 p-3"
      data-testid="report-sheet"
    >
      <p className="text-sm font-medium">Report this review</p>
      <p className="text-xs text-ink-500">
        Our team checks reports within 24 hours. Negative opinions that follow the rules stay up.
      </p>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label="Reason">
        {REASONS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`reason-${review.id}`}
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {label}
          </label>
        ))}
      </div>
      <textarea
        className={`${input} h-20 py-2`}
        maxLength={1000}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="Anything our team should know (optional)"
        aria-label="Details"
      />
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={!reason || busy}
          onClick={() => void send()}
          data-testid="send-report"
        >
          Send report
        </button>
        <button type="button" className={btn.secondary} onClick={() => onClose(false)}>
          Cancel
        </button>
      </div>
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function ReviewsPage() {
  const { business } = useBiz();
  const [tab, setTab] = useState<Tab>('needs_reply');
  const [reporting, setReporting] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { data, reload } = useLoad(async () => {
    const { data: d, error } = await supabase().rpc('biz_get_reviews', {
      p_business_id: business.id,
      p_tab: tab === 'photos' ? 'all' : tab,
    });
    if (error) return { error: describeError(codeOf(error)) };
    return d as unknown as Payload;
  }, [business.id, tab]);

  const s = data && 'summary' in data ? data.summary : null;
  return (
    <>
      <PageHeader title="Reviews" subtitle="Verified reviews from completed bookings and visits." />
      <Body>
        <Notice>
          Reviews can’t be removed or hidden by businesses. Reply publicly, or report a review that
          breaks the rules.
        </Notice>
        {s ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="reviews-summary">
            <div className="rounded-card border border-line-200 bg-surface-0 p-3">
              <p className="text-xs text-ink-500">Rating</p>
              {s.display_rating !== null ? (
                <p className="text-xl font-semibold">
                  {s.display_rating.toFixed(1)}{' '}
                  <Stars value={s.display_rating} className="text-sm" />
                </p>
              ) : (
                <p className="text-sm text-ink-700">Shown from 5 reviews</p>
              )}
            </div>
            <div className="rounded-card border border-line-200 bg-surface-0 p-3">
              <p className="text-xs text-ink-500">Verified reviews</p>
              <p className="text-xl font-semibold">{s.review_count}</p>
            </div>
            <div className="rounded-card border border-line-200 bg-surface-0 p-3">
              <p className="text-xs text-ink-500">Response rate</p>
              <p className="text-xl font-semibold">
                {s.response_rate !== null ? `${s.response_rate}%` : '—'}
              </p>
            </div>
            <div className="rounded-card border border-line-200 bg-surface-0 p-3">
              <p className="text-xs text-ink-500">Needs reply</p>
              <p className="text-xl font-semibold" data-testid="needs-reply-count">
                {s.needs_reply}
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex gap-2" role="tablist" aria-label="Filter reviews">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`rounded-full border px-3 py-1 text-sm ${
                tab === key
                  ? 'border-accent-600 bg-accent-600 text-white'
                  : 'border-line-200 bg-surface-0'
              }`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {flash ? <Notice tone="success">{flash}</Notice> : null}

        {tab === 'photos' ? (
          <ResultsFeaturing businessId={business.id} />
        ) : !data ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : 'error' in data ? (
          <Notice tone="danger">{data.error}</Notice>
        ) : data.reviews.length === 0 ? (
          <p className="text-sm text-ink-700" data-testid="reviews-empty">
            {tab === 'needs_reply'
              ? 'You’re all caught up.'
              : tab === 'reported'
                ? 'You haven’t reported any reviews.'
                : 'No reviews yet. Customers are invited to review 2 hours after a completed visit.'}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-200 rounded-card border border-line-200 bg-surface-0 px-4">
            {data.reviews.map((r) => (
              <ReviewCard key={r.id} r={r} businessName={business.name}>
                <ReplyBox
                  review={r}
                  onDone={(message) => {
                    setFlash(message);
                    void reload();
                  }}
                />
                {r.report ? (
                  <p className="text-xs text-ink-500" data-testid="report-status">
                    {REPORT_STATUS[r.report.status] ?? r.report.status}
                    {r.report.resolution_note ? ` · ${r.report.resolution_note}` : ''}
                  </p>
                ) : reporting === r.id ? (
                  <ReportSheet
                    review={r}
                    businessId={business.id}
                    onClose={(sent) => {
                      setReporting(null);
                      if (sent) {
                        setFlash('Report sent. We’ll let you know the outcome.');
                        void reload();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="self-start text-xs text-ink-500 hover:underline"
                    onClick={() => setReporting(r.id)}
                    data-testid="report"
                  >
                    Report
                  </button>
                )}
              </ReviewCard>
            ))}
          </ul>
        )}
      </Body>
    </>
  );
}
