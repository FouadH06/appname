'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { Database } from '@app/db';
import { Badge, Shell, State, Table, btn, field, fmt, statusTone, useData } from '@/components/ui';
import { BUSINESS_ROLES, canSee, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A4 Businesses: search + filters → detail.

type Status = Database['public']['Enums']['business_status'];
interface Row {
  id: string;
  name: string;
  slug: string;
  status: Status;
  is_test: boolean;
  verification_status: string;
  published_at: string | null;
  category: string | null;
  area: string | null;
  cluster: { id: string; name: string } | null;
  bookings_30d: number;
  rating: number | null;
  open_reports: number;
  owner_claimed: boolean;
}

function Businesses() {
  const access = useAdminGate(BUSINESS_ROLES);
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const cluster = params.get('cluster');
  const { data, error, loading } = useData<Row[]>(
    () =>
      supabase().rpc('admin_list_businesses', {
        p_q: q.trim() || undefined,
        p_status: status || undefined,
        p_cluster_id: cluster ?? undefined,
      }),
    [q, status, cluster],
  );
  if (!access) return null;
  return (
    <Shell
      access={access}
      title="Businesses"
      actions={
        canSee(access.admin_role, ['ops']) ? (
          <Link href="/businesses/new" className={btn.primary + ' inline-flex items-center'}>
            + Create business
          </Link>
        ) : null
      }
    >
      <div className="flex gap-2">
        <input
          className={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, link or phone"
          aria-label="Search businesses"
        />
        <select
          className={field + ' max-w-48'}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          aria-label="Status"
        >
          <option value="">All statuses</option>
          {['draft', 'live', 'paused', 'suspended', 'closed'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {cluster ? (
          <Link href="/businesses" className="self-center text-sm text-accent-600">
            Clear cluster filter
          </Link>
        ) : null}
      </div>
      <State
        loading={loading && !data}
        error={error}
        empty={data?.length === 0}
        emptyText="No businesses match."
      />
      {data?.length ? (
        <Table
          rows={data}
          testId="businesses"
          href={(b) => `/businesses/${b.id}`}
          cols={[
            [
              'Name',
              (b) => (
                <span>
                  {b.name} {b.is_test ? <Badge>test</Badge> : null}
                </span>
              ),
            ],
            ['Area', (b) => `${b.area ?? '—'}${b.cluster ? ` · ${b.cluster.name}` : ''}`],
            ['Category', (b) => b.category ?? '—'],
            ['Status', (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge>],
            ['Live since', (b) => fmt(b.published_at, false)],
            ['Bookings 30d', (b) => b.bookings_30d],
            ['Rating', (b) => b.rating ?? '—'],
            [
              'Open reports',
              (b) => (b.open_reports ? <Badge tone="warn">{b.open_reports}</Badge> : 0),
            ],
            [
              'Owner',
              (b) => (b.owner_claimed ? 'claimed' : <span className="text-ink-500">not yet</span>),
            ],
          ]}
        />
      ) : null}
    </Shell>
  );
}

export default function BusinessesPage() {
  return (
    <Suspense>
      <Businesses />
    </Suspense>
  );
}
