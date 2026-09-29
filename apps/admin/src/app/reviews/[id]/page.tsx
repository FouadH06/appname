'use client';

import Link from 'next/link';
import { use } from 'react';
import {
  ActionDialog,
  AuditLink,
  Badge,
  Card,
  Shell,
  State,
  fmt,
  statusTone,
  useData,
} from '@/components/ui';
import { REVIEW_ROLES, canSee, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A6 Review detail: all parts with their state, weight explanation (tier × decay × fraud multiplier),
// fraud signals, pipeline checks, cases, reports, booking timeline. Actions: quarantine / restore / remove.

interface Detail {
  review: {
    id: string;
    overall: number;
    text_original: string | null;
    text_display: string | null;
    text_state: string | null;
    status: string;
    rating_state: string;
    trust_tier: string;
    visit_at: string;
    created_at: string;
    removed_reason: string | null;
    legal_hold: boolean;
  };
  business: { id: string; name: string; slug: string };
  service: string | null;
  staff: string | null;
  ratings: Record<string, number>;
  author: {
    id: string;
    name: string | null;
    status: string;
    joined: string;
    reviews: number;
  } | null;
  weight: { base: number; fraud_multiplier: number; decay: number; counted: boolean };
  fraud_signals: { signal: string; score: number; status: string; created_at: string }[];
  checks: {
    stage: string;
    outcome: string;
    labels: string[];
    model: string | null;
    created_at: string;
  }[];
  cases: {
    id: string;
    source: string;
    state: string;
    decision: string | null;
    reason: string | null;
    created_at: string;
  }[];
  reports: { id: string; reason: string; status: string; reporter: string; created_at: string }[];
  booking_events: { event: string; actor: string; to: string | null; created_at: string }[];
}

export default function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const access = useAdminGate(REVIEW_ROLES);
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<Detail>(() => supabase().rpc('admin_get_review', { p_review_id: id }), [id]);
  if (!access) return null;
  if (!d)
    return (
      <Shell access={access} title="Review">
        <State loading={loading} error={error} />
      </Shell>
    );
  const r = d.review;
  const canQuarantine = ['active', 'pending_check'].includes(r.rating_state);
  const canRestore =
    ['quarantined', 'removed'].includes(r.rating_state) && r.status !== 'deleted_by_author';

  return (
    <Shell
      access={access}
      title={
        <span className="flex items-center gap-2">
          {'★'.repeat(r.overall)} review of {d.business.name}
          <Badge tone={statusTone(r.rating_state)}>
            {r.status} · {r.rating_state.replace('_', ' ')}
          </Badge>
          {r.legal_hold ? <Badge tone="bad">legal hold</Badge> : null}
        </span>
      }
      actions={
        <>
          {canQuarantine ? (
            <ActionDialog
              label="Quarantine"
              title="Quarantine (weight 0 while investigating; reversible)"
              reasons={reasons('quarantine')}
              testId="quarantine"
              run={(reason, note) =>
                supabase().rpc('admin_quarantine_review', {
                  p_review_id: r.id,
                  p_reason: reason,
                  p_note: note || undefined,
                })
              }
              onDone={() => void reload()}
            />
          ) : null}
          {canRestore ? (
            <ActionDialog
              label="Restore"
              title="Restore this review (published and counted again)"
              reasons={reasons('restore')}
              testId="restore"
              run={(reason, note) =>
                supabase().rpc('admin_restore_review', {
                  p_review_id: r.id,
                  p_reason: reason,
                  p_note: note || undefined,
                })
              }
              onDone={() => void reload()}
            />
          ) : null}
          {r.text_state && r.text_state !== 'removed' && r.status !== 'removed' ? (
            <ActionDialog
              label="Remove comment"
              title="Remove the comment (stars stay)"
              reasons={reasons('removeReview')}
              danger
              run={(reason, note) =>
                supabase().rpc('admin_remove_review', {
                  p_review_id: r.id,
                  p_part: 'text',
                  p_reason: reason,
                  p_note: note || undefined,
                })
              }
              onDone={() => void reload()}
            />
          ) : null}
          {r.status !== 'removed' && r.status !== 'deleted_by_author' ? (
            <ActionDialog
              label="Remove review"
              title="Remove the whole review (no longer shown or counted)"
              reasons={reasons('removeReview')}
              danger
              testId="remove-review"
              run={(reason, note) =>
                supabase().rpc('admin_remove_review', {
                  p_review_id: r.id,
                  p_part: 'review',
                  p_reason: reason,
                  p_note: note || undefined,
                })
              }
              onDone={() => void reload()}
            />
          ) : null}
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card title="Review">
          <p className="text-sm text-ink-500">
            {d.service ?? '—'} · {d.staff ?? '—'} · visit {fmt(r.visit_at, false)} ·{' '}
            {r.trust_tier.replace('_', ' ')}
          </p>
          {Object.keys(d.ratings).length ? (
            <p className="mt-1 text-xs text-ink-500">
              {Object.entries(d.ratings)
                .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
                .join(' · ')}
            </p>
          ) : null}
          {r.text_original ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm" dir="auto">
                {r.text_original}
              </p>
              {r.text_display && r.text_display !== r.text_original ? (
                <p className="mt-2 text-xs text-ink-500" dir="auto">
                  Shown as: {r.text_display}
                </p>
              ) : null}
              <p className="mt-1 text-xs">
                Comment: <Badge tone={statusTone(r.text_state ?? '')}>{r.text_state}</Badge>
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-500">Stars only.</p>
          )}
          {r.removed_reason ? (
            <p className="mt-2 text-xs text-danger-600">Removed: {r.removed_reason}</p>
          ) : null}
          <div className="mt-3 flex gap-3">
            <AuditLink subjectId={r.id} />
            <Link href={`/businesses/${d.business.id}`} className="text-sm text-accent-600">
              Business →
            </Link>
          </div>
        </Card>
        <Card title="Weight">
          <p className="text-sm" data-testid="weight">
            {d.weight.base} (tier) × {d.weight.decay} (age) × {d.weight.fraud_multiplier} (fraud) ={' '}
            <b>{(d.weight.base * d.weight.decay * d.weight.fraud_multiplier).toFixed(3)}</b>
          </p>
          <p className="mt-1 text-sm">
            {d.weight.counted ? '✅ counted in the rating' : '⛔ not counted'}
          </p>
          {d.fraud_signals.length ? (
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {d.fraud_signals.map((f, i) => (
                <li key={i}>
                  {f.signal.replace(/_/g, ' ')} ({f.score}) · {f.status}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-500">No fraud signals.</p>
          )}
        </Card>
        <Card title="Author">
          {d.author ? (
            <div className="text-sm">
              <p>
                {d.author.name ?? 'No name'}{' '}
                <Badge tone={statusTone(d.author.status)}>{d.author.status}</Badge>
              </p>
              <p className="text-ink-500">
                joined {fmt(d.author.joined, false)} · {d.author.reviews} review(s)
              </p>
              {canSee(access.admin_role, ['support']) ? (
                <Link href={`/customers/${d.author.id}`} className="text-accent-600">
                  Customer record →
                </Link>
              ) : null}
            </div>
          ) : (
            '—'
          )}
        </Card>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card title="Checks and cases">
          <ul className="flex flex-col gap-1 text-xs">
            {d.checks.map((c, i) => (
              <li key={i}>
                {fmt(c.created_at)} · {c.stage}: <b>{c.outcome}</b> {c.labels.join(', ')}{' '}
                {c.model ? `(${c.model})` : ''}
              </li>
            ))}
            {d.cases.map((c) => (
              <li key={c.id}>
                <Link href={`/moderation/${c.id}`} className="text-accent-600">
                  Case
                </Link>{' '}
                · {c.source} · {c.state}
                {c.decision ? ` · ${c.decision} (${c.reason})` : ''}
              </li>
            ))}
            {d.reports.map((x) => (
              <li key={x.id}>
                Report by {x.reporter}: {x.reason.replace(/_/g, ' ')} · {x.status}
              </li>
            ))}
            {!d.checks.length && !d.cases.length && !d.reports.length ? (
              <li className="text-ink-500">Nothing recorded.</li>
            ) : null}
          </ul>
        </Card>
        <Card title="Booking timeline">
          <ul className="flex flex-col gap-1 text-xs">
            {d.booking_events.map((e, i) => (
              <li key={i}>
                {fmt(e.created_at)} · {e.event.replace(/_/g, ' ')} by {e.actor}
                {e.to ? ` → ${e.to}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
