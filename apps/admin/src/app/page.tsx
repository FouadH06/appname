'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Card, Shell, State, Table, ago, btn, useData } from '@/components/ui';
import { ANY_ADMIN, canSee, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A1 Overview: what needs a human now (queues with SLA), cluster health, alerts, today's totals.
// Auto-refresh every 60 s.

interface Queue {
  count: number;
  oldest: string | null;
  overdue?: number;
  by_type?: Record<string, number>;
}
interface Overview {
  queues: { images: Queue; text: Queue; reports: Queue; disputes: Queue };
  clusters: {
    id: string;
    name: string;
    target: number;
    live: number;
    by_category: Record<string, number>;
    bookings_today: number;
    bookings_7d: number;
    completion_rate: number | null;
    marketplace_share: number | null;
  }[];
  alerts: {
    notifications_failed_24h: number;
    notifications_total_24h: number;
    notifications_stuck: number;
    media_errors_24h: number;
  };
  today: { new_customers: number; new_bookings: number; reviews: number; results: number };
}

const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export default function AdminOverview() {
  const access = useAdminGate(ANY_ADMIN);
  const { data, error, loading, reload } = useData<Overview>(
    () => supabase().rpc('admin_overview'),
    [],
  );
  useEffect(() => {
    const t = window.setInterval(() => void reload(), 60_000);
    return () => window.clearInterval(t);
  }, [reload]);

  if (!access) return null;
  const role = access.admin_role;
  const tile = (label: string, q: Queue | undefined, href: string, visible: boolean) =>
    visible ? (
      <Link
        href={href}
        className={`flex flex-col rounded-card border bg-surface-0 p-4 ${
          q && (q.overdue ?? 0) > 0 ? 'border-warning-600' : 'border-line-200'
        }`}
        data-testid="queue-tile"
      >
        <span className="text-sm text-ink-500">{label}</span>
        <span className="text-2xl font-semibold">{q ? q.count : '…'}</span>
        <span className="text-xs text-ink-500">
          {!q
            ? ''
            : q.count === 0
              ? 'All clear'
              : `oldest ${ago(q.oldest)}${q.overdue ? ` · ${q.overdue} overdue` : ''}`}
        </span>
      </Link>
    ) : null;
  const a = data?.alerts;
  const failRate =
    a && a.notifications_total_24h ? a.notifications_failed_24h / a.notifications_total_24h : 0;

  return (
    <Shell
      access={access}
      title="Overview"
      actions={
        canSee(role, ['ops']) ? (
          <Link
            href="/businesses/new"
            className={btn.primary + ' inline-flex items-center'}
            data-testid="create-business-link"
          >
            + Create business
          </Link>
        ) : null
      }
    >
      <p className="text-sm text-ink-500" data-testid="admin-home">
        Signed in as {role} (MFA verified).
      </p>
      <State loading={loading && !data} error={error} />
      <div className="grid grid-cols-4 gap-3">
        {tile(
          'Images awaiting review',
          data?.queues.images,
          '/moderation',
          canSee(role, ['moderator', 'support']),
        )}
        {tile(
          'Text awaiting review',
          data?.queues.text,
          '/moderation',
          canSee(role, ['moderator', 'support']),
        )}
        {tile(
          'Reports open',
          data?.queues.reports,
          '/moderation',
          canSee(role, ['moderator', 'support']),
        )}
        {tile('Disputes open', data?.queues.disputes, '/disputes', canSee(role, ['support']))}
      </div>
      {data?.queues.disputes.by_type && Object.keys(data.queues.disputes.by_type).length ? (
        <p className="text-xs text-ink-500">
          Disputes by type:{' '}
          {Object.entries(data.queues.disputes.by_type)
            .map(([k, n]) => `${k.replace('_', ' ')} ${n}`)
            .join(' · ')}
        </p>
      ) : null}

      <Card title="Cluster health">
        {data ? (
          <Table
            rows={data.clusters}
            testId="clusters"
            href={
              canSee(role, ['moderator', 'support', 'ops'])
                ? (c) => `/businesses?cluster=${c.id}`
                : undefined
            }
            cols={[
              ['Cluster', (c) => c.name],
              [
                'Live / target',
                (c) => (
                  <span className={c.live < c.target ? 'text-warning-600' : ''}>
                    {c.live} / {c.target}
                  </span>
                ),
              ],
              [
                'By category',
                (c) =>
                  Object.entries(c.by_category)
                    .map(([k, n]) => `${k} ${n}`)
                    .join(' · ') || '—',
              ],
              ['Bookings today / 7d', (c) => `${c.bookings_today} / ${c.bookings_7d}`],
              ['Completion (30d)', (c) => pct(c.completion_rate)],
              ['Marketplace share', (c) => pct(c.marketplace_share)],
            ]}
          />
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card title="Alerts">
          {a ? (
            <ul className="flex flex-col gap-1 text-sm">
              <li className={failRate > 0.05 ? 'text-danger-600' : ''}>
                WhatsApp/SMS failures (24h): {a.notifications_failed_24h} of{' '}
                {a.notifications_total_24h} ({pct(failRate)})
              </li>
              <li className={a.notifications_stuck > 0 ? 'text-danger-600' : ''}>
                Messages stuck in the queue &gt; 15 min: {a.notifications_stuck}
              </li>
              <li className={a.media_errors_24h > 0 ? 'text-warning-600' : ''}>
                Photo processing errors (24h): {a.media_errors_24h}
              </li>
            </ul>
          ) : null}
        </Card>
        <Card title="Today">
          {data ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-500">New customers</dt>
              <dd>{data.today.new_customers}</dd>
              <dt className="text-ink-500">New bookings</dt>
              <dd>{data.today.new_bookings}</dd>
              <dt className="text-ink-500">Reviews posted</dt>
              <dd>{data.today.reviews}</dd>
              <dt className="text-ink-500">Results posted</dt>
              <dd>{data.today.results}</dd>
            </dl>
          ) : null}
        </Card>
      </div>
    </Shell>
  );
}
