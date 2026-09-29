'use client';

import { useState } from 'react';
import { Badge, Shell, State, Table, field, fmt, statusTone, useData } from '@/components/ui';
import { CUSTOMER_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A5 Customers: find a person by phone, name or booking reference.

interface Row {
  id: string;
  name: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  bookings: number;
}

export default function Customers() {
  const access = useAdminGate(CUSTOMER_ROLES);
  const [q, setQ] = useState('');
  const query = q.trim();
  const { data, error, loading } = useData<Row[]>(
    () =>
      query.length >= 2
        ? supabase().rpc('admin_search_customers', { p_q: query })
        : Promise.resolve({ data: [], error: null }),
    [query],
  );
  if (!access) return null;
  return (
    <Shell access={access} title="Customers">
      <input
        className={field}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Phone (e.g. 70 123 456), name or booking reference"
        aria-label="Search customers"
        autoFocus
      />
      {query.length < 2 ? (
        <p className="text-sm text-ink-500">Type at least 2 characters.</p>
      ) : (
        <State
          loading={loading && !data}
          error={error}
          empty={data?.length === 0}
          emptyText="No customer with that phone, name or reference."
        />
      )}
      {query.length >= 2 && data?.length ? (
        <Table
          rows={data}
          testId="customers"
          href={(c) => `/customers/${c.id}`}
          cols={[
            ['Name', (c) => c.name ?? <span className="text-ink-500">No name</span>],
            ['Phone', (c) => c.phone ?? '—'],
            ['Status', (c) => <Badge tone={statusTone(c.status)}>{c.status}</Badge>],
            ['Joined', (c) => fmt(c.created_at, false)],
            ['Bookings', (c) => c.bookings],
          ]}
        />
      ) : null}
    </Shell>
  );
}
