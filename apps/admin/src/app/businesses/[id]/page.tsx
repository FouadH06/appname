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
  Table,
  field,
  fmt,
  statusTone,
  useData,
} from '@/components/ui';
import { BUSINESS_ROLES, canSee, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A4 Business detail: profile, onboarding checklist, members, stats, reports/disputes, ranking inputs,
// audit. Actions (ops): publish / pause / suspend / close (upcoming bookings: keep or cancel), verify, test flag.

type Status = Database['public']['Enums']['business_status'];
interface Detail {
  business: {
    id: string;
    name: string;
    slug: string;
    status: Status;
    status_reason: string | null;
    verification_status: string;
    is_test: boolean;
    published_at: string | null;
    created_at: string;
    category: string | null;
    cluster: { name: string } | null;
  };
  locations: { id: string; area: string; address: string; phone: string | null; status: string }[];
  checklist: { key: string; ok: boolean }[];
  members: {
    user_id: string;
    role: string;
    status: string;
    name: string | null;
    phone: string | null;
  }[];
  stats: {
    upcoming: number;
    bookings_30d: number;
    completed_30d: number;
    no_shows_30d: number;
    rating: { review_count: number; display_rating: number | null } | null;
  };
  reports: {
    id: string;
    reason: string;
    status: string;
    subject_type: string;
    created_at: string;
  }[];
  disputes: {
    id: string;
    type: string;
    status: string;
    outcome: string | null;
    created_at: string;
  }[];
}
interface Explain {
  active_version: number;
  weights: Record<string, number>;
  score: { score: number; components: Record<string, unknown> } | null;
  inputs: Record<string, unknown>;
}

const CHECK: Record<string, string> = {
  location: 'Location',
  hours: 'Opening hours',
  service: 'Bookable service with staff',
  staff_hours: 'Staff hours',
  cover: 'Cover photo',
};

export default function BusinessDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const access = useAdminGate(BUSINESS_ROLES);
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<Detail>(() => supabase().rpc('admin_get_business', { p_business_id: id }), [id]);
  const isOps = canSee(access?.admin_role, ['ops']);
  const { data: ex } = useData<Explain>(
    () =>
      isOps
        ? supabase().rpc('admin_explain_rank', { p_business_id: id })
        : Promise.resolve({ data: null, error: null }),
    [id, isOps],
  );
  const [target, setTarget] = useState<Status>('paused');
  const [upcoming, setUpcoming] = useState<'keep' | 'cancel' | ''>('');

  if (!access) return null;
  if (!d)
    return (
      <Shell access={access} title="Business">
        <State loading={loading} error={error} />
      </Shell>
    );
  const b = d.business;
  const needsChoice = (target === 'suspended' || target === 'closed') && d.stats.upcoming > 0;

  return (
    <Shell
      access={access}
      title={
        <span className="flex items-center gap-2">
          {b.name} <Badge tone={statusTone(b.status)}>{b.status}</Badge>
          {b.is_test ? <Badge>test</Badge> : null}
          {b.verification_status === 'verified' ? <Badge tone="good">verified</Badge> : null}
        </span>
      }
      actions={
        isOps ? (
          <>
            <ActionDialog
              label="Change status"
              title={`Change status of ${b.name}`}
              reasons={reasons('businessStatus')}
              danger={target === 'suspended' || target === 'closed'}
              testId="change-status"
              disabled={false}
              run={(reason, note) =>
                supabase().rpc('admin_set_business_status', {
                  p_business_id: b.id,
                  p_status: target,
                  p_reason: reason,
                  p_note: note || undefined,
                  p_upcoming: needsChoice ? upcoming || undefined : undefined,
                })
              }
              onDone={() => void reload()}
            >
              <select
                className={field}
                value={target}
                onChange={(e) => setTarget(e.target.value as Status)}
                aria-label="New status"
              >
                {(['live', 'paused', 'suspended', 'closed'] as Status[])
                  .filter((s) => s !== b.status)
                  .map((s) => (
                    <option key={s} value={s}>
                      {s === 'live' ? 'Publish (live)' : s}
                    </option>
                  ))}
              </select>
              {target === 'suspended' || target === 'closed' ? (
                <p className="text-sm text-ink-700">
                  The public page shows the business as unavailable.
                  {d.stats.upcoming > 0 ? ` It has ${d.stats.upcoming} upcoming booking(s):` : ''}
                </p>
              ) : null}
              {needsChoice ? (
                <div
                  className="flex flex-col gap-1 text-sm"
                  role="radiogroup"
                  aria-label="Upcoming bookings"
                >
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={upcoming === 'keep'}
                      onChange={() => setUpcoming('keep')}
                    />
                    Keep them valid
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={upcoming === 'cancel'}
                      onChange={() => setUpcoming('cancel')}
                    />
                    Cancel them and notify the customers
                  </label>
                </div>
              ) : null}
            </ActionDialog>
            <ActionDialog
              label={b.verification_status === 'verified' ? 'Remove verification' : 'Verify'}
              title="Verification (placeholder flag)"
              reasons={reasons('verify')}
              run={(reason, note) =>
                supabase().rpc('admin_verify_business', {
                  p_business_id: b.id,
                  p_verified: b.verification_status !== 'verified',
                  p_reason: reason,
                  p_note: note || undefined,
                })
              }
              onDone={() => void reload()}
            />
            <ActionDialog
              label={b.is_test ? 'Unmark test' : 'Mark as test'}
              title="Test business (excluded from overview counts)"
              reasons={reasons('testFlag')}
              run={(reason) =>
                supabase().rpc('admin_set_business_test', {
                  p_business_id: b.id,
                  p_is_test: !b.is_test,
                  p_reason: reason,
                })
              }
              onDone={() => void reload()}
            />
          </>
        ) : null
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card title="Profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-500">Link</dt>
            <dd>platform.com/{b.slug}</dd>
            <dt className="text-ink-500">Category</dt>
            <dd>{b.category ?? '—'}</dd>
            <dt className="text-ink-500">Cluster</dt>
            <dd>{b.cluster?.name ?? '—'}</dd>
            <dt className="text-ink-500">Created</dt>
            <dd>{fmt(b.created_at, false)}</dd>
            <dt className="text-ink-500">Live since</dt>
            <dd>{fmt(b.published_at, false)}</dd>
            {b.status_reason ? (
              <>
                <dt className="text-ink-500">Status reason</dt>
                <dd>{b.status_reason}</dd>
              </>
            ) : null}
          </dl>
          {d.locations.map((l) => (
            <p key={l.id} className="mt-2 text-sm text-ink-700">
              📍 {l.area} · {l.address} {l.phone ? `· ${l.phone}` : ''} <Badge>{l.status}</Badge>
            </p>
          ))}
          <div className="mt-3">
            <AuditLink businessId={b.id} label="Everything that changed here" />
          </div>
        </Card>
        <Card title="Go-live checklist">
          <ul className="flex flex-col gap-1 text-sm" data-testid="checklist">
            {d.checklist.map((c) => (
              <li key={c.key}>
                {c.ok ? '✅' : '⬜'} {CHECK[c.key] ?? c.key}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Bookings (30 days)">
          <dl className="grid grid-cols-2 gap-1 text-sm">
            <dt className="text-ink-500">Upcoming</dt>
            <dd>{d.stats.upcoming}</dd>
            <dt className="text-ink-500">Bookings</dt>
            <dd>{d.stats.bookings_30d}</dd>
            <dt className="text-ink-500">Completed</dt>
            <dd>{d.stats.completed_30d}</dd>
            <dt className="text-ink-500">No-shows</dt>
            <dd>{d.stats.no_shows_30d}</dd>
            <dt className="text-ink-500">Rating</dt>
            <dd>
              {d.stats.rating?.display_rating ?? '—'} ({d.stats.rating?.review_count ?? 0} counted)
            </dd>
          </dl>
          <Link
            href={`/reviews?business=${b.id}`}
            className="mt-2 inline-block text-sm text-accent-600"
          >
            Reviews →
          </Link>
        </Card>
      </div>

      <Card title="Members">
        <Table
          rows={d.members}
          cols={[
            ['Name', (m) => m.name ?? '—'],
            ['Role', (m) => m.role],
            ['Status', (m) => m.status],
            ['Phone', (m) => m.phone ?? '—'],
            [
              '',
              (m) =>
                canSee(access.admin_role, ['support']) ? (
                  <Link className="text-accent-600" href={`/customers/${m.user_id}`}>
                    Open
                  </Link>
                ) : null,
            ],
          ]}
        />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card title="Reports">
          <State empty={d.reports.length === 0} emptyText="No reports." />
          {d.reports.length ? (
            <Table
              rows={d.reports}
              cols={[
                ['Reason', (r) => r.reason.replace(/_/g, ' ')],
                ['About', (r) => r.subject_type.replace('_', ' ')],
                ['Status', (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>],
                ['When', (r) => fmt(r.created_at)],
              ]}
            />
          ) : null}
        </Card>
        <Card title="Disputes">
          <State empty={d.disputes.length === 0} emptyText="No disputes." />
          {d.disputes.length ? (
            <Table
              rows={d.disputes}
              href={canSee(access.admin_role, ['support']) ? (x) => `/disputes/${x.id}` : undefined}
              cols={[
                ['Type', (x) => x.type.replace('_', ' ')],
                ['Status', (x) => <Badge tone={statusTone(x.status)}>{x.status}</Badge>],
                ['Outcome', (x) => x.outcome?.replace(/_/g, ' ') ?? '—'],
                ['Opened', (x) => fmt(x.created_at)],
              ]}
            />
          ) : null}
        </Card>
      </div>

      {ex ? (
        <Card title={`Why this rank (config v${ex.active_version})`}>
          {ex.score ? (
            <pre className="overflow-x-auto text-xs">{JSON.stringify(ex.score, null, 2)}</pre>
          ) : (
            <p className="text-sm text-ink-700">
              Quality scores are computed once search ships (M12). Inputs today:
            </p>
          )}
          <pre className="mt-2 overflow-x-auto rounded bg-surface-50 p-2 text-xs">
            {JSON.stringify(ex.inputs, null, 2)}
          </pre>
        </Card>
      ) : null}
    </Shell>
  );
}
