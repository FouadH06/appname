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
import { CUSTOMER_ROLES, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A5 Customer detail: status, reliability internals (admin only — businesses see a coarse label),
// bookings (forgive a no-show), reviews, disputes, notification log. Actions: warn / suspend / reactivate.

type UserStatus = Database['public']['Enums']['user_status'];
interface Detail {
  profile: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    status: UserStatus;
    status_reason: string | null;
    created_at: string;
    is_admin: boolean;
  };
  reliability: {
    score: number;
    tier: string;
    events: {
      kind: string;
      weight: number;
      occurred_at: string;
      booking_ref: string | null;
      business: string | null;
      note: string | null;
    }[];
  };
  bookings: {
    id: string;
    ref: string;
    business: string;
    starts_at: string;
    status: string;
    source: string;
    no_show_disputed: boolean;
    forgiven: boolean;
  }[];
  reviews: {
    id: string;
    business: string;
    overall: number;
    status: string;
    rating_state: string;
    created_at: string;
  }[];
  disputes: {
    id: string;
    type: string;
    status: string;
    outcome: string | null;
    created_at: string;
  }[];
  notifications: {
    type: string;
    status: string;
    channel: string | null;
    attempts: number;
    last_error: string | null;
    created_at: string;
    sent_at: string | null;
  }[];
}

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const access = useAdminGate(CUSTOMER_ROLES);
  const {
    data: d,
    error,
    loading,
    reload,
  } = useData<Detail>(() => supabase().rpc('admin_get_customer', { p_user_id: id }), [id]);
  const [status, setStatus] = useState<UserStatus>('warned');
  if (!access) return null;
  if (!d)
    return (
      <Shell access={access} title="Customer">
        <State loading={loading} error={error} />
      </Shell>
    );
  const p = d.profile;
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'No name';

  return (
    <Shell
      access={access}
      title={
        <span className="flex items-center gap-2">
          {name} <Badge tone={statusTone(p.status)}>{p.status}</Badge>
          {p.is_admin ? <Badge tone="warn">admin</Badge> : null}
        </span>
      }
      actions={
        <ActionDialog
          label="Change status"
          title={`Account status for ${name}`}
          reasons={reasons('userStatus')}
          danger={status === 'suspended'}
          testId="change-user-status"
          run={(reason, note) =>
            supabase().rpc('admin_set_user_status', {
              p_user_id: p.id,
              p_status: status,
              p_reason: reason,
              p_note: note || undefined,
            })
          }
          onDone={() => void reload()}
        >
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value as UserStatus)}
            aria-label="New status"
          >
            {(['active', 'warned', 'suspended'] as UserStatus[])
              .filter((s) => s !== p.status)
              .map((s) => (
                <option key={s} value={s}>
                  {s === 'active' ? 'Reactivate' : s}
                </option>
              ))}
          </select>
          {status === 'suspended' ? (
            <p className="text-sm text-ink-700">
              A suspended customer can't book or review until reactivated.
            </p>
          ) : null}
        </ActionDialog>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Card title="Profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-500">Phone</dt>
            <dd>{p.phone ?? '—'}</dd>
            <dt className="text-ink-500">Joined</dt>
            <dd>{fmt(p.created_at, false)}</dd>
            {p.status_reason ? (
              <>
                <dt className="text-ink-500">Status reason</dt>
                <dd>{p.status_reason}</dd>
              </>
            ) : null}
          </dl>
          <div className="mt-3">
            <AuditLink subjectId={p.id} />
          </div>
        </Card>
        <Card title="Reliability (internal)">
          <p className="text-sm" data-testid="reliability">
            <Badge tone={statusTone(d.reliability.tier)}>
              {d.reliability.tier.replace('_', ' ')}
            </Badge>{' '}
            score {d.reliability.score}
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-700">
            {d.reliability.events.length === 0 ? (
              <li className="text-ink-500">No events in 180 days.</li>
            ) : null}
            {d.reliability.events.map((e, i) => (
              <li key={i}>
                {fmt(e.occurred_at, false)} · {e.kind.replace('_', ' ')} ({e.weight > 0 ? '+' : ''}
                {e.weight}) {e.business ? `· ${e.business}` : ''}{' '}
                {e.booking_ref ? `· ${e.booking_ref}` : ''}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Disputes">
          <State empty={d.disputes.length === 0} emptyText="No disputes." />
          <ul className="flex flex-col gap-1 text-sm">
            {d.disputes.map((x) => (
              <li key={x.id}>
                <Link href={`/disputes/${x.id}`} className="text-accent-600">
                  {x.type.replace('_', ' ')}
                </Link>{' '}
                <Badge tone={statusTone(x.status)}>
                  {x.outcome?.replace(/_/g, ' ') ?? x.status}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Bookings">
        <State empty={d.bookings.length === 0} emptyText="No bookings." />
        {d.bookings.length ? (
          <Table
            rows={d.bookings}
            testId="customer-bookings"
            cols={[
              ['Ref', (k) => k.ref],
              ['Business', (k) => k.business],
              ['When', (k) => fmt(k.starts_at)],
              ['Source', (k) => k.source.replace(/_/g, ' ')],
              [
                'Status',
                (k) => (
                  <span className="flex gap-1">
                    <Badge tone={statusTone(k.status)}>{k.status.replace('_', ' ')}</Badge>
                    {k.no_show_disputed ? <Badge tone="warn">contested</Badge> : null}
                    {k.forgiven ? <Badge tone="good">forgiven</Badge> : null}
                  </span>
                ),
              ],
              [
                '',
                (k) =>
                  k.status === 'no_show' && !k.forgiven ? (
                    <ActionDialog
                      label="Forgive"
                      title={`Forgive the no-show ${k.ref}`}
                      reasons={reasons('forgive')}
                      testId="forgive"
                      run={(reason, note) =>
                        supabase().rpc('admin_forgive_reliability', {
                          p_booking_id: k.id,
                          p_reason: reason,
                          p_note: note || undefined,
                        })
                      }
                      onDone={() => void reload()}
                    >
                      <p className="text-sm text-ink-700">
                        Reverses this no-show's reliability penalty. The booking itself stays as
                        marked.
                      </p>
                    </ActionDialog>
                  ) : null,
              ],
            ]}
          />
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card title="Reviews">
          <State empty={d.reviews.length === 0} emptyText="No reviews." />
          {d.reviews.length ? (
            <Table
              rows={d.reviews}
              href={(r) => `/reviews/${r.id}`}
              cols={[
                ['Business', (r) => r.business],
                ['Stars', (r) => '★'.repeat(r.overall)],
                [
                  'Status',
                  (r) => (
                    <Badge tone={statusTone(r.rating_state)}>
                      {r.status} · {r.rating_state}
                    </Badge>
                  ),
                ],
                ['When', (r) => fmt(r.created_at, false)],
              ]}
            />
          ) : null}
        </Card>
        <Card title="Notification log (last 50)">
          <State empty={d.notifications.length === 0} emptyText="No messages." />
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto text-xs">
            {d.notifications.map((n, i) => (
              <li key={i} className={n.status === 'failed' ? 'text-danger-600' : ''}>
                {fmt(n.created_at)} · {n.type.replace(/_/g, ' ')} · {n.status}
                {n.channel ? ` (${n.channel})` : ''}
                {n.last_error ? ` · ${n.last_error}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Shell>
  );
}
