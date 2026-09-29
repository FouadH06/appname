'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { messageForCode } from '@app/i18n';
import { MODERATION_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A3 Case detail (minimal, M9): the content, why it's here (pipeline stages, report, fraud signals),
// claim, then decide with a reason code. Every decision is audited (audit.admin_actions).

type Decision =
  'approve' | 'approve_redacted' | 'reject' | 'remove_text' | 'remove_review' | 'escalate';

interface CaseDetail {
  case: {
    id: string;
    subject_type: string;
    source: string;
    reasons: string[];
    state: string;
    claimed_by: string | null;
    decision: string | null;
  };
  content: {
    kind: string;
    original: string | null;
    display: string | null;
    normalized: string | null;
  };
  review: {
    overall: number;
    status: string;
    rating_state: string;
    text_state: string | null;
    trust_tier: string;
  };
  context: { business: string; service: string; canonical: string; staff: string; source: string };
  stages: {
    stage: string;
    outcome: string;
    labels: string[];
    model: string | null;
    scores: Record<string, unknown>;
  }[];
  author: {
    account_age_days: number | null;
    reviews: number;
    status: string;
    fraud_signals: { signal: string; score: number; status: string }[];
  };
  report: { reason: string; details: string | null; reporter_kind: string } | null;
}

const field = 'w-full rounded-control border border-line-200 bg-surface-0 px-3 py-2 text-sm';
const btnCls =
  'h-10 rounded-control border border-line-200 px-3 text-sm font-medium disabled:opacity-50';

const REASON_CODES = [
  'follows_policy',
  'contact_details',
  'targets_staff',
  'threat',
  'hate',
  'sexual_harassment',
  'spam',
  'confirmed_fraud',
  'legit_shared_device',
  'other',
];

function decisionsFor(d: CaseDetail): [Decision, string][] {
  if (d.case.source === 'fraud') {
    return [
      ['approve', 'Dismiss — restore the review'],
      ['remove_review', 'Confirm fraud — remove the review'],
      ['escalate', 'Escalate'],
    ];
  }
  return [
    ['approve', 'Approve text'],
    ['approve_redacted', 'Approve with redaction'],
    ['reject', 'Reject text (author may edit)'],
    ['remove_text', 'Remove text'],
    ['remove_review', 'Remove whole review'],
    ['escalate', 'Escalate'],
  ];
}

export default function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const access = useAdminGate(MODERATION_ROLES);
  const [d, setD] = useState<CaseDetail | null>(null);
  const [decision, setDecision] = useState<Decision | ''>('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [redacted, setRedacted] = useState('');
  const [userAction, setUserAction] = useState<'none' | 'warn' | 'suspend'>('none');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase().rpc('admin_get_case', { p_case_id: caseId });
    if (e) return setError(messageForCode('en', e.message));
    const detail = data as unknown as CaseDetail;
    setD(detail);
    setRedacted(detail.content.display ?? detail.content.original ?? '');
  }, [caseId]);
  useEffect(() => {
    if (!access) return;
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [access, load]);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true);
    setError(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) {
      setError(messageForCode('en', e.message));
      return false;
    }
    return true;
  };
  const claim = () =>
    run(() => supabase().rpc('admin_claim_case', { p_case_id: caseId })).then(async (ok) => {
      if (ok) await load();
    });
  const decide = () =>
    run(() =>
      supabase().rpc('admin_decide_case', {
        p_case_id: caseId,
        p_decision: decision as Decision,
        p_reason_code: reason,
        p_note: note.trim() || undefined,
        p_redaction: decision === 'approve_redacted' ? { text: redacted } : undefined,
        p_user_action: userAction,
      }),
    ).then((ok) => ok && setDone(true));

  if (!access) return null;
  if (!d) return <main className="mx-auto max-w-3xl px-4 py-8 text-sm">{error ?? 'Loading…'}</main>;

  const decided = d.case.state === 'decided' || done;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
      <Link href="/moderation" className="text-sm text-accent-600">
        ← Queue
      </Link>
      <header>
        <h1 className="text-xl font-semibold">
          {d.case.source === 'fraud'
            ? 'Fraud check'
            : d.case.source === 'report'
              ? 'Report'
              : 'Automatic check'}{' '}
          · {d.content.kind.replace('_', ' ')}
        </h1>
        <p className="text-sm text-ink-500">
          {d.context.business} · {d.context.service} ({d.context.canonical}) · with{' '}
          {d.context.staff} · {d.context.source}
        </p>
        <p className="text-sm text-ink-500">Reasons: {d.case.reasons.join(', ')}</p>
      </header>

      <section className="rounded-card border border-line-200 p-4" data-testid="case-content">
        <p className="text-sm text-ink-500">
          {'★'.repeat(d.review.overall)} · {d.review.trust_tier} · rating {d.review.rating_state} ·
          text {d.review.text_state ?? '—'}
        </p>
        <p className="mt-2 whitespace-pre-line" dir="auto">
          {d.content.original ?? '(no text)'}
        </p>
        {d.content.display && d.content.display !== d.content.original ? (
          <p className="mt-2 text-sm text-ink-700">Shown as: {d.content.display}</p>
        ) : null}
      </section>

      {d.report ? (
        <section className="rounded-card border border-line-200 p-4 text-sm">
          <p className="font-medium">
            Reported by the {d.report.reporter_kind}: {d.report.reason.replace(/_/g, ' ')}
          </p>
          {d.report.details ? <p className="mt-1 text-ink-700">{d.report.details}</p> : null}
        </section>
      ) : null}

      <section className="grid gap-4 text-sm md:grid-cols-2">
        <div className="rounded-card border border-line-200 p-4">
          <p className="font-medium">Checks</p>
          <ul className="mt-2 flex flex-col gap-1">
            {d.stages.map((s, i) => (
              <li key={i}>
                {s.stage}: <b>{s.outcome}</b> {s.labels.length ? `· ${s.labels.join(', ')}` : ''}{' '}
                {s.model ? <span className="text-ink-500">({s.model})</span> : null}
              </li>
            ))}
            {d.stages.length === 0 ? <li className="text-ink-500">None recorded</li> : null}
          </ul>
        </div>
        <div className="rounded-card border border-line-200 p-4">
          <p className="font-medium">Author</p>
          <p className="mt-2">
            Account {d.author.account_age_days ?? '?'} days old · {d.author.reviews} reviews ·{' '}
            {d.author.status}
          </p>
          {d.author.fraud_signals.map((f, i) => (
            <p key={i}>
              {f.signal.replace(/_/g, ' ')} · {f.score} · {f.status}
            </p>
          ))}
        </div>
      </section>

      {decided ? (
        <p className="text-sm font-medium text-success-600" data-testid="case-decided">
          Decided{d.case.decision ? `: ${d.case.decision}` : ''}.
        </p>
      ) : d.case.state === 'open' || !d.case.claimed_by ? (
        <button
          type="button"
          className={btnCls}
          disabled={busy}
          onClick={() => void claim()}
          data-testid="claim-case"
        >
          Claim case
        </button>
      ) : (
        <section
          className="flex flex-col gap-3 rounded-card border border-line-200 p-4"
          data-testid="decide"
        >
          <p className="font-medium">Decision</p>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Decision">
            {decisionsFor(d).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="decision"
                  checked={decision === value}
                  onChange={() => setDecision(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {decision === 'approve_redacted' ? (
            <textarea
              className={`${field} h-24`}
              dir="auto"
              value={redacted}
              onChange={(e) => setRedacted(e.target.value)}
              aria-label="Text to publish"
            />
          ) : null}
          <select
            className={field}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason code"
          >
            <option value="">Reason code…</option>
            {REASON_CODES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            className={field}
            value={userAction}
            onChange={(e) => setUserAction(e.target.value as typeof userAction)}
            aria-label="Action on the author"
          >
            <option value="none">No action on the author</option>
            <option value="warn">Warn the author</option>
            {access.admin_role === 'support' || access.admin_role === 'superadmin' ? (
              <option value="suspend">Suspend the author</option>
            ) : null}
          </select>
          <textarea
            className={`${field} h-16`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (shown to the business for report outcomes)"
            aria-label="Note"
          />
          <button
            type="button"
            className="h-10 rounded-control bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !decision || !reason}
            onClick={() => void decide()}
            data-testid="submit-decision"
          >
            Submit decision
          </button>
        </section>
      )}
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </main>
  );
}
