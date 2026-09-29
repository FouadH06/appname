'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { Database } from '@app/db';
import {
  ActionDialog,
  AuditLink,
  Badge,
  Card,
  Shell,
  State,
  btn,
  errorText,
  field,
  fmt,
  statusTone,
  useData,
} from '@/components/ui';
import { DISPUTE_ROLES, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A7 Case detail: parties, statements, the booking event log (key evidence), customer reliability,
// the business's dispute history; internal notes / info requests; resolution with effects.

type Outcome = Database['public']['Enums']['dispute_outcome'];
interface Detail {
  dispute: {
    id: string;
    type: Database['public']['Enums']['dispute_type'];
    status: string;
    outcome: Outcome | null;
    due_at: string;
    created_at: string;
    resolved_at: string | null;
    resolution_note: string | null;
    legal_hold: boolean;
  };
  business: {
    id: string;
    name: string;
    history: Record<string, number>;
    no_shows_90d: number;
  } | null;
  customer: {
    id: string;
    name: string | null;
    phone: string | null;
    status: string;
    reliability: { score: number; tier: string } | null;
    disputes: number;
  } | null;
  booking: {
    id: string;
    ref: string;
    status: string;
    starts_at: string;
    source: string;
    created_by_kind: string;
    no_show_at: string | null;
    services: string[];
  } | null;
  events: {
    event: string;
    actor: string;
    from: string | null;
    to: string | null;
    data: Record<string, unknown>;
    created_at: string;
  }[];
  notifications: {
    type: string;
    status: string;
    sent_at: string | null;
    read_at: string | null;
    created_at: string;
  }[];
  messages: {
    id: string;
    author_kind: string;
    visibility: string;
    body: string;
    created_at: string;
  }[];
  review: {
    id: string;
    overall: number;
    text: string | null;
    status: string;
    text_state: string | null;
    rating_state: string;
  } | null;
}

const OUTCOMES: Record<string, [Outcome, string][]> = {
  no_show: [
    ['no_show_upheld', 'Uphold the no-show'],
    [
      'no_show_overturned',
      'Overturn (visit counts as completed, penalty reversed, review allowed)',
    ],
    ['voided', 'Void (neither side penalized)'],
  ],
  review_attendance: [
    ['review_kept', 'Keep the review'],
    ['review_text_removed', 'Remove the comment (stars stay)'],
    ['review_removed', 'Remove the review'],
    ['voided', 'Void'],
  ],
  legal: [
    ['legal_kept', 'Keep with note'],
    ['legal_removed', 'Remove (kept under legal hold)'],
    ['voided', 'Void'],
  ],
  ownership: [
    ['ownership_transferred', 'Ownership transferred (done by hand)'],
    ['ownership_denied', 'Ownership denied'],
    ['voided', 'Void'],
  ],
};

export default function DisputeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const access = useAdminGate(DISPUTE_ROLES);
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<Detail>(() => supabase().rpc('admin_get_dispute', { p_dispute_id: id }), [id]);
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [body, setBody] = useState('');
  const [msgError, setMsgError] = useState<string | null>(null);
  if (!access) return null;
  if (!d)
    return (
      <Shell access={access} title="Dispute">
        <State loading={loading} error={error} />
      </Shell>
    );
  const x = d.dispute;
  const open = x.status === 'open' || x.status === 'awaiting_info';

  const send = async (internal: boolean, requestInfo: boolean) => {
    setMsgError(null);
    const { error: e } = await supabase().rpc('admin_add_dispute_message', {
      p_dispute_id: x.id,
      p_body: body,
      p_internal: internal,
      p_request_info: requestInfo,
    });
    if (e) return setMsgError(errorText(e));
    setBody('');
    void reload();
  };

  return (
    <Shell
      access={access}
      title={
        <span className="flex items-center gap-2">
          {x.type.replace('_', ' ')} dispute
          <Badge tone={statusTone(x.status)}>
            {x.outcome?.replace(/_/g, ' ') ?? x.status.replace('_', ' ')}
          </Badge>
          {x.legal_hold ? <Badge tone="bad">legal hold</Badge> : null}
        </span>
      }
      actions={
        open ? (
          <ActionDialog
            label="Resolve"
            title="Resolve this dispute"
            reasons={reasons('dispute')}
            confirmText="Resolve and notify both sides"
            testId="resolve-dispute"
            run={(reason, note) =>
              outcome
                ? supabase().rpc('admin_resolve_dispute', {
                    p_dispute_id: x.id,
                    p_outcome: outcome,
                    p_reason: reason,
                    p_note: note || undefined,
                  })
                : Promise.resolve({ error: { message: 'INVALID_INPUT' } })
            }
            onDone={() => void reload()}
          >
            <div className="flex flex-col gap-1 text-sm" role="radiogroup" aria-label="Outcome">
              {(OUTCOMES[x.type] ?? []).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="outcome"
                    checked={outcome === v}
                    onChange={() => setOutcome(v)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </ActionDialog>
        ) : null
      }
    >
      <p className="text-sm text-ink-500">
        Opened {fmt(x.created_at)} · due {fmt(x.due_at)}
        {x.resolved_at ? ` · resolved ${fmt(x.resolved_at)}` : ''}
        {x.resolution_note ? ` · “${x.resolution_note}”` : ''}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Card title="Booking">
          {d.booking ? (
            <div className="text-sm">
              <p>
                {d.booking.ref} · {d.booking.services.join(', ')}
              </p>
              <p className="text-ink-500">
                {fmt(d.booking.starts_at)} · {d.booking.source.replace(/_/g, ' ')} · created by{' '}
                {d.booking.created_by_kind}
              </p>
              <p className="mt-1">
                <Badge tone={statusTone(d.booking.status)}>
                  {d.booking.status.replace('_', ' ')}
                </Badge>
              </p>
            </div>
          ) : (
            '—'
          )}
          {d.review ? (
            <div className="mt-3 text-sm">
              <Link href={`/reviews/${d.review.id}`} className="text-accent-600">
                {'★'.repeat(d.review.overall)} review
              </Link>
              {d.review.text ? (
                <p className="mt-1 text-ink-700" dir="auto">
                  {d.review.text}
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>
        <Card title="Customer">
          {d.customer ? (
            <div className="text-sm">
              <Link href={`/customers/${d.customer.id}`} className="text-accent-600">
                {d.customer.name ?? 'No name'}
              </Link>{' '}
              · {d.customer.phone}
              <p className="mt-1">
                <Badge tone={statusTone(d.customer.reliability?.tier ?? 'new')}>
                  {d.customer.reliability?.tier ?? 'new'}
                </Badge>{' '}
                score {d.customer.reliability?.score ?? 0} · {d.customer.disputes} dispute(s) in
                total
              </p>
            </div>
          ) : (
            '—'
          )}
        </Card>
        <Card title="Business">
          {d.business ? (
            <div className="text-sm">
              <Link href={`/businesses/${d.business.id}`} className="text-accent-600">
                {d.business.name}
              </Link>
              <p className="mt-1 text-ink-500">No-shows marked (90d): {d.business.no_shows_90d}</p>
              <p className="text-ink-500">
                No-show disputes:{' '}
                {Object.entries(d.business.history)
                  .map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`)
                  .join(' · ') || 'none'}
              </p>
            </div>
          ) : (
            '—'
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card title="Evidence: booking events and messages sent">
          <ul className="flex flex-col gap-1 text-xs" data-testid="evidence">
            {d.events.map((e, i) => (
              <li key={`e${i}`}>
                {fmt(e.created_at)} · <b>{e.event.replace(/_/g, ' ')}</b> by {e.actor}
                {e.to ? ` (${e.from ?? '—'} → ${e.to})` : ''}
              </li>
            ))}
            {d.notifications.map((n, i) => (
              <li key={`n${i}`} className="text-ink-500">
                {fmt(n.created_at)} · message {n.type.replace(/_/g, ' ')} · {n.status}
                {n.read_at ? ` · read ${fmt(n.read_at)}` : ''}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Statements and notes">
          <ul className="flex flex-col gap-2 text-sm">
            {d.messages.map((m) => (
              <li
                key={m.id}
                className={m.visibility === 'internal' ? 'rounded bg-surface-50 p-2' : ''}
              >
                <span className="text-xs text-ink-500">
                  {m.author_kind}
                  {m.visibility === 'internal' ? ' · internal' : ''} · {fmt(m.created_at)}
                </span>
                <p className="whitespace-pre-wrap" dir="auto">
                  {m.body}
                </p>
              </li>
            ))}
          </ul>
          {open ? (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                className={`${field} h-20`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Internal note, or a message to the customer"
                aria-label="Message"
              />
              {msgError ? (
                <p className="text-sm text-danger-600" role="alert">
                  {msgError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={body.trim().length < 2}
                  onClick={() => void send(true, false)}
                >
                  Add internal note
                </button>
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={body.trim().length < 2}
                  onClick={() => void send(false, true)}
                  data-testid="request-info"
                >
                  Ask the customer for more info
                </button>
              </div>
            </div>
          ) : null}
          <div className="mt-3">
            <AuditLink subjectId={x.id} />
          </div>
        </Card>
      </div>
    </Shell>
  );
}
