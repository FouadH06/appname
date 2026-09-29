'use client';

import { useState } from 'react';
import type { Database } from '@app/db';
import { Badge, Shell, State, Table, fmt, statusTone, useData } from '@/components/ui';
import { DISPUTE_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A7 Disputes: type tabs → SLA-sorted list → case. Legal requests are superadmin only.

type DisputeType = Database['public']['Enums']['dispute_type'];
type DisputeStatus = Database['public']['Enums']['dispute_status'];
interface Row {
  id: string;
  type: DisputeType;
  status: DisputeStatus;
  outcome: string | null;
  due_at: string;
  created_at: string;
  business: string;
  booking_ref: string | null;
  messages: number;
  legal_hold: boolean;
}

const TABS: [DisputeType | '', string][] = [
  ['', 'All open'],
  ['no_show', 'No-show'],
  ['review_attendance', 'Review ("never came")'],
  ['legal', 'Legal'],
];

export default function Disputes() {
  const access = useAdminGate(DISPUTE_ROLES);
  const [type, setType] = useState<DisputeType | ''>('');
  const [resolved, setResolved] = useState(false);
  const { data, error, loading } = useData<Row[]>(
    () =>
      supabase().rpc('admin_list_disputes', {
        p_type: type || undefined,
        p_status: resolved ? 'resolved' : undefined,
      }),
    [type, resolved],
  );
  if (!access) return null;
  const tabs = TABS.filter(([t]) => t !== 'legal' || access.admin_role === 'superadmin');
  return (
    <Shell access={access} title="Reports & disputes">
      <div className="flex flex-wrap items-center gap-2" role="tablist">
        {tabs.map(([t, label]) => (
          <button
            key={t || 'all'}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={`rounded-full border px-3 py-1 text-sm ${type === t ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
            onClick={() => setType(t)}
          >
            {label}
          </button>
        ))}
        <label className="ms-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(e) => setResolved(e.target.checked)}
          />{' '}
          Show resolved
        </label>
      </div>
      <p className="text-xs text-ink-500">
        Content reports on reviews and photos are worked in Moderation.
      </p>
      <State
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="No open cases."
      />
      {data?.length ? (
        <Table
          rows={data}
          testId="disputes"
          href={(x) => `/disputes/${x.id}`}
          cols={[
            ['Type', (x) => x.type.replace('_', ' ')],
            ['Business', (x) => x.business],
            ['Booking', (x) => x.booking_ref ?? '—'],
            [
              'Status',
              (x) => (
                <Badge tone={statusTone(x.status)}>
                  {x.outcome?.replace(/_/g, ' ') ?? x.status.replace('_', ' ')}
                </Badge>
              ),
            ],
            [
              'Due',
              (x) => (
                <span
                  className={
                    x.status !== 'resolved' && new Date(x.due_at) < new Date()
                      ? 'text-danger-600'
                      : ''
                  }
                >
                  {fmt(x.due_at)}
                </span>
              ),
            ],
            ['Messages', (x) => x.messages],
            ['Opened', (x) => fmt(x.created_at)],
          ]}
        />
      ) : null}
    </Shell>
  );
}
