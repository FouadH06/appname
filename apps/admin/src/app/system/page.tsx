'use client';

import { Badge, Card, Shell, State, Table, ago, useData } from '@/components/ui';
import { OPS_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// M14 System health (ops): scheduled jobs (failing / stale), queue backlogs, message delivery in the
// last 24 h, database size. The job list is a 5-minute snapshot of pg_cron.

interface Job {
  job: string;
  schedule: string;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
  runs_24h: number;
  failures_24h: number;
  stale: boolean;
  failing: boolean;
}
interface Health {
  jobs: Job[];
  queues: Record<string, number | { count: number; oldest: string | null } | null>;
  delivery_24h: Record<string, { sent: number; failed: number; rate: number | null }>;
  alerts: string[];
  db_size_mb: number;
}

const ALERT_TEXT: Record<string, string> = {
  job_failing: 'A scheduled job failed on its last run',
  job_stale: 'A scheduled job has not run when expected',
  no_health_snapshot: 'No job snapshot in the last 15 minutes (is pg_cron running?)',
  notifications_overdue: 'Messages waiting more than 15 minutes',
  search_refresh_backlog: 'Search refresh queue is backing up',
  photos_backlog: 'Customer photos waiting more than 30 minutes',
  comments_backlog: 'Review comments waiting more than 1 hour',
  account_deletions: 'Account deletions overdue or needing support',
  whatsapp_delivery_low: 'WhatsApp delivery below 90 % (24 h)',
};
const QUEUE_TEXT: Record<string, string> = {
  notifications_overdue: 'Messages overdue (> 15 min)',
  notifications_processing_stuck: 'Messages stuck in processing',
  search_refresh: 'Search refresh queue',
  photos_pending_30m: 'Photos pending > 30 min',
  comments_pending_1h: 'Comments pending > 1 h',
  account_deletions_overdue: 'Account deletions overdue',
  account_deletions_need_support: 'Account deletions needing support',
  health_snapshot_age_s: 'Job snapshot age (s)',
};

export default function SystemPage() {
  const access = useAdminGate(OPS_ROLES);
  const { data, error, loading } = useData<Health>(() => supabase().rpc('admin_system_health'), []);
  if (!access) return null;
  return (
    <Shell access={access} title="System health">
      <div className="flex flex-col gap-4" data-testid="system-health">
        <State loading={loading} error={error} />
        {data ? (
          <>
            <Card title="Alerts">
              {data.alerts.length ? (
                <ul className="flex flex-col gap-1 text-sm" data-testid="health-alerts">
                  {data.alerts.map((a) => (
                    <li key={a} className="text-danger-600">
                      {ALERT_TEXT[a] ?? a}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-success-600">All clear.</p>
              )}
            </Card>
            <Card title="Queues">
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                {Object.entries(data.queues).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <dt className="text-ink-700">{QUEUE_TEXT[k] ?? k}</dt>
                    <dd className="font-medium">
                      {v === null
                        ? '—'
                        : typeof v === 'object'
                          ? `${v.count}${v.oldest ? ` · oldest ${ago(v.oldest)}` : ''}`
                          : v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            <Card title="Message delivery (24 h)">
              {Object.keys(data.delivery_24h).length ? (
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  {Object.entries(data.delivery_24h).map(([ch, d]) => (
                    <div key={ch}>
                      <dt className="capitalize text-ink-700">{ch}</dt>
                      <dd className="font-medium">
                        {d.rate === null ? '—' : `${Math.round(d.rate * 100)} %`}{' '}
                        <span className="text-ink-500">
                          ({d.sent} sent · {d.failed} failed)
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-ink-500">No messages in the last 24 hours.</p>
              )}
            </Card>
            <Card title={`Scheduled jobs · database ${data.db_size_mb} MB`}>
              <Table
                rows={data.jobs}
                testId="jobs"
                cols={[
                  ['Job', (j) => <span className="font-mono text-xs">{j.job}</span>],
                  ['Schedule', (j) => <span className="font-mono text-xs">{j.schedule}</span>],
                  [
                    'State',
                    (j) =>
                      !j.active ? (
                        <Badge>paused</Badge>
                      ) : j.failing ? (
                        <Badge tone="bad">failing</Badge>
                      ) : j.stale ? (
                        <Badge tone="warn">late</Badge>
                      ) : (
                        <Badge tone="good">ok</Badge>
                      ),
                  ],
                  ['Last run', (j) => (j.last_run_at ? ago(j.last_run_at) : 'never')],
                  ['24 h', (j) => `${j.runs_24h} runs · ${j.failures_24h} failed`],
                  [
                    'Last message',
                    (j) => (
                      <span className="line-clamp-2 text-xs text-ink-500">{j.last_message}</span>
                    ),
                  ],
                ]}
              />
            </Card>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
