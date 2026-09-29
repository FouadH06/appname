'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { messageForCode } from '@app/i18n';
import { getPublicEnv } from '@/env';
import { MODERATION_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A3 image case (M10): the photo is blurred until the moderator chooses to look; why it's here
// (pipeline stages, report); claim; decide with a reason code. Audited (moderation.decide_media).

interface MediaCase {
  case: {
    id: string;
    subject_type: string;
    source: string;
    reasons: string[];
    state: string;
    claimed_by: string | null;
    decision: string | null;
  };
  media: {
    id: string;
    status: string;
    width: number | null;
    height: number | null;
    processor: string | null;
    image: { bucket: string; path: string | null };
  };
  result: { id: string; state: string; minor_flag: boolean; kind: string } | null;
  context: {
    business: string | null;
    service: string | null;
    canonical: string | null;
    staff: string | null;
  };
  stages: {
    stage: string;
    outcome: string;
    labels: string[];
    model: string | null;
    scores: Record<string, unknown>;
  }[];
  report: { reason: string; details: string | null; reporter_kind: string } | null;
}

type Decision = 'approve' | 'reject' | 'remove_media' | 'escalate';
const REASON_CODES = [
  'relevant_result',
  'not_relevant',
  'not_your_result',
  'contact_info',
  'guidelines',
  'minor',
  'other',
];
const field = 'w-full rounded-control border border-line-200 bg-surface-0 px-3 py-2 text-sm';

export default function MediaCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const access = useAdminGate(MODERATION_ROLES);
  const [d, setD] = useState<MediaCase | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [decision, setDecision] = useState<Decision | ''>('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [keepMinor, setKeepMinor] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase().rpc('admin_get_media_case', { p_case_id: caseId });
    if (e) return setError(messageForCode('en', e.message));
    const c = data as unknown as MediaCase;
    setD(c);
    const img = c.media.image;
    if (!img.path) return;
    if (img.bucket === 'ugc-staging') {
      // private: short-lived signed URL (storage policy lets moderators read staging only)
      const { data: signed } = await supabase()
        .storage.from('ugc-staging')
        .createSignedUrl(img.path, 120);
      setSrc(signed?.signedUrl ?? null);
    } else {
      setSrc(
        `${getPublicEnv().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${img.bucket}/${img.path}`,
      );
    }
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
    if (e) setError(messageForCode('en', e.message));
    return !e;
  };

  if (!access) return null;
  if (!d) return <main className="mx-auto max-w-3xl px-4 py-8 text-sm">{error ?? 'Loading…'}</main>;
  const decided = d.case.state === 'decided' || done;
  const claimed = d.case.state === 'claimed' && !!d.case.claimed_by;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-8">
      <Link href="/moderation" className="text-sm text-accent-600">
        ← Queue
      </Link>
      <header>
        <h1 className="text-xl font-semibold">
          {d.case.source === 'report' ? 'Report' : 'Automatic check'} ·{' '}
          {d.case.subject_type === 'review_media' ? 'customer photo' : 'business photo'}
        </h1>
        <p className="text-sm text-ink-500">
          {d.context.business}
          {d.context.service ? ` · ${d.context.service} (${d.context.canonical})` : ''}
          {d.context.staff ? ` · with ${d.context.staff}` : ''}
        </p>
        <p className="text-sm text-ink-500">Reasons: {d.case.reasons.join(', ')}</p>
      </header>

      <section className="flex flex-col gap-2" data-testid="media-case-image">
        <div className="relative overflow-hidden rounded-card bg-ink-900">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- moderation preview
            <img
              src={src}
              alt="Photo under review"
              className={`mx-auto max-h-[60vh] object-contain transition ${reveal ? '' : 'scale-105 blur-2xl'}`}
              data-revealed={reveal}
            />
          ) : (
            <p className="p-6 text-sm text-white">Image not available</p>
          )}
        </div>
        <button
          type="button"
          className="self-start text-sm text-accent-600"
          onClick={() => setReveal((x) => !x)}
          data-testid="reveal"
        >
          {reveal ? 'Blur again' : 'Reveal image'}
        </button>
        <p className="text-xs text-ink-500">
          {d.media.width}×{d.media.height} · {d.media.status} · processor {d.media.processor ?? '—'}
          {d.result?.minor_flag ? ' · minor flagged' : ''}
        </p>
      </section>

      {d.report ? (
        <section className="rounded-card border border-line-200 p-4 text-sm">
          <p className="font-medium">
            Reported by the {d.report.reporter_kind}: {d.report.reason.replace(/_/g, ' ')}
          </p>
          {d.report.details ? <p className="mt-1 text-ink-700">{d.report.details}</p> : null}
        </section>
      ) : null}

      <section className="rounded-card border border-line-200 p-4 text-sm">
        <p className="font-medium">Checks</p>
        <ul className="mt-2 flex flex-col gap-1">
          {d.stages.map((s, i) => (
            <li key={i}>
              {s.stage}: <b>{s.outcome}</b> {s.labels.length ? `· ${s.labels.join(', ')}` : ''}
              {s.model ? <span className="text-ink-500"> ({s.model})</span> : null}
            </li>
          ))}
        </ul>
      </section>

      {decided ? (
        <p className="text-sm font-medium text-success-600" data-testid="case-decided">
          Decided{d.case.decision ? `: ${d.case.decision}` : ''}.
        </p>
      ) : !claimed ? (
        <button
          type="button"
          className="h-10 rounded-control border border-line-200 px-3 text-sm font-medium"
          disabled={busy}
          onClick={() =>
            void run(() => supabase().rpc('admin_claim_case', { p_case_id: caseId })).then(
              async (ok) => {
                if (ok) await load();
              },
            )
          }
          data-testid="claim-case"
        >
          Claim case
        </button>
      ) : (
        <section
          className="flex flex-col gap-3 rounded-card border border-line-200 p-4"
          data-testid="decide"
        >
          <div className="flex flex-col gap-1" role="radiogroup" aria-label="Decision">
            {(
              [
                [
                  'approve',
                  d.result?.state === 'approved'
                    ? 'Keep published (report not upheld)'
                    : 'Approve — publish',
                ],
                ['reject', 'Reject (author told the reason)'],
                ['remove_media', 'Remove'],
                ['escalate', 'Escalate'],
              ] as [Decision, string][]
            ).map(([v, label]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="decision"
                  checked={decision === v}
                  onChange={() => setDecision(v)}
                />
                {label}
              </label>
            ))}
          </div>
          {decision === 'approve' && d.result?.minor_flag ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keepMinor}
                onChange={(e) => setKeepMinor(e.target.checked)}
              />
              Keep the minor flag (the photo can never be featured)
            </label>
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
          <textarea
            className={`${field} h-16`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            aria-label="Note"
          />
          <button
            type="button"
            className="h-10 rounded-control bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !decision || !reason}
            onClick={() =>
              void run(() =>
                supabase().rpc('admin_decide_media_case', {
                  p_case_id: caseId,
                  p_decision: decision as Decision,
                  p_reason_code: reason,
                  p_note: note.trim() || undefined,
                  p_keep_minor_flag: d.result?.minor_flag ? keepMinor : undefined,
                }),
              ).then((ok) => ok && setDone(true))
            }
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
