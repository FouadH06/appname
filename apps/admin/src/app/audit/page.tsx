'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Badge, Shell, State, Table, btn, errorText, field, fmt } from '@/components/ui';
import { ANY_ADMIN, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A10 Audit log: admin actions + business/system changes + booking events in one append-only view.
// Filters come from the URL too (detail pages link here with subject_id / business_id). PII in diffs is
// masked by the backend for everyone but superadmin.

interface Entry {
  source: 'admin' | 'business' | 'customer' | 'system';
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  actor: string | null;
  action: string;
  subject_type: string;
  subject_id: string | null;
  business_id: string | null;
  business: string | null;
  reason: string | null;
  note: string | null;
  before: unknown;
  after: unknown;
}

const KEYS = [
  'source',
  'action',
  'subject_type',
  'subject_id',
  'business_id',
  'actor_user_id',
  'from',
  'to',
] as const;
type Filters = Partial<Record<(typeof KEYS)[number], string>>;

const subjectHref = (e: Entry): string | null => {
  if (!e.subject_id) return null;
  if (e.subject_type === 'business') return `/businesses/${e.subject_id}`;
  if (e.subject_type === 'user') return `/customers/${e.subject_id}`;
  if (e.subject_type === 'review') return `/reviews/${e.subject_id}`;
  if (e.subject_type === 'dispute') return `/disputes/${e.subject_id}`;
  return null;
};

function Audit() {
  const access = useAdminGate(ANY_ADMIN);
  const params = useSearchParams();
  const [f, setF] = useState<Filters>(() =>
    Object.fromEntries(KEYS.map((k) => [k, params.get(k) ?? ''])),
  );
  const [applied, setApplied] = useState<Filters>(f);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Entry | null>(null);

  const load = async (before?: string) => {
    const filters = Object.fromEntries(
      Object.entries(applied)
        .filter(([, v]) => v)
        .map(([k, v]) => [k, k === 'from' || k === 'to' ? new Date(v!).toISOString() : v]),
    );
    const { data, error: e } = await supabase().rpc('admin_get_audit', {
      p_filters: filters,
      p_before: before,
      p_limit: 50,
    });
    if (e) return setError(errorText(e));
    setError(null);
    const page = (data as unknown as Entry[]) ?? [];
    setRows((r) => (before ? [...(r ?? []), ...page] : page));
    setMore(page.length === 50);
  };
  useEffect(() => {
    if (!access) return;
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the applied filters change
  }, [access, applied]);

  if (!access) return null;
  const input = (k: keyof Filters, placeholder: string, type = 'text') => (
    <input
      className={field}
      type={type}
      value={f[k] ?? ''}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setF({ ...f, [k]: e.target.value })}
    />
  );
  return (
    <Shell access={access} title="Audit log">
      <form
        className="grid grid-cols-4 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRows(null);
          setApplied({ ...f });
        }}
      >
        <select
          className={field}
          value={f.source ?? ''}
          onChange={(e) => setF({ ...f, source: e.target.value })}
          aria-label="Actor type"
        >
          <option value="">All actors</option>
          <option value="admin">Admin</option>
          <option value="business">Business member</option>
          <option value="customer">Customer</option>
          <option value="system">System</option>
        </select>
        {input('action', 'Action (prefix, e.g. business.)')}
        {input('subject_type', 'Subject type')}
        {input('subject_id', 'Subject ID')}
        {input('business_id', 'Business ID')}
        {input('actor_user_id', 'Actor user ID')}
        {input('from', 'From', 'datetime-local')}
        {input('to', 'To', 'datetime-local')}
        <div className="col-span-4 flex gap-2">
          <button type="submit" className={btn.primary}>
            Apply filters
          </button>
          <button
            type="button"
            className={btn.secondary}
            onClick={() => {
              setF({});
              setRows(null);
              setApplied({});
            }}
          >
            Clear
          </button>
        </div>
      </form>
      <State
        loading={!rows && !error}
        error={error}
        empty={rows?.length === 0}
        emptyText="No events match these filters."
      />
      {rows?.length ? (
        <Table
          rows={rows}
          testId="audit"
          cols={[
            [
              'Time',
              (e) => (
                <button type="button" className="text-accent-600" onClick={() => setOpen(e)}>
                  {fmt(e.created_at)}
                </button>
              ),
            ],
            [
              'Actor',
              (e) => (
                <span>
                  <Badge tone={e.source === 'admin' ? 'warn' : 'neutral'}>{e.source}</Badge>{' '}
                  {e.actor ?? ''} <span className="text-ink-500">{e.actor_role ?? ''}</span>
                </span>
              ),
            ],
            ['Action', (e) => <code className="text-xs">{e.action}</code>],
            [
              'Subject',
              (e) => {
                const href = subjectHref(e);
                const label = `${e.subject_type}${e.business ? ` · ${e.business}` : ''}`;
                return href ? (
                  <Link className="text-accent-600" href={href}>
                    {label}
                  </Link>
                ) : (
                  label
                );
              },
            ],
            [
              'Reason',
              (e) =>
                e.reason ? (
                  <span>
                    {e.reason.replace(/_/g, ' ')}
                    {e.note ? <span className="text-ink-500"> · {e.note}</span> : null}
                  </span>
                ) : (
                  '—'
                ),
            ],
          ]}
        />
      ) : null}
      {more ? (
        <button
          type="button"
          className={btn.secondary + ' self-start'}
          onClick={() => void load(rows?.at(-1)?.created_at)}
        >
          Load more
        </button>
      ) : null}
      {open ? (
        <aside
          className="fixed inset-y-0 end-0 z-40 w-[36rem] overflow-y-auto border-s border-line-200 bg-surface-0 p-5 shadow-xl"
          data-testid="audit-detail"
        >
          <div className="flex items-center">
            <h2 className="font-semibold">{open.action}</h2>
            <button
              type="button"
              className="ms-auto text-sm text-ink-500"
              onClick={() => setOpen(null)}
            >
              Close
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {fmt(open.created_at)} · {open.source} {open.actor ?? open.actor_user_id ?? 'system'}{' '}
            {open.actor_role ? `(${open.actor_role})` : ''}
          </p>
          {open.reason ? (
            <p className="mt-2 text-sm">
              Reason: {open.reason.replace(/_/g, ' ')}
              {open.note ? ` — ${open.note}` : ''}
            </p>
          ) : null}
          <p className="mt-3 text-xs font-medium text-ink-500">Before</p>
          <pre className="overflow-x-auto rounded bg-surface-50 p-2 text-xs">
            {JSON.stringify(open.before, null, 2) ?? '—'}
          </pre>
          <p className="mt-3 text-xs font-medium text-ink-500">After / changes</p>
          <pre className="overflow-x-auto rounded bg-surface-50 p-2 text-xs">
            {JSON.stringify(open.after, null, 2) ?? '—'}
          </pre>
          <p className="mt-3 text-xs text-ink-500">
            Subject {open.subject_type} {open.subject_id ?? ''}
          </p>
        </aside>
      ) : null}
    </Shell>
  );
}

export default function AuditPage() {
  return (
    <Suspense>
      <Audit />
    </Suspense>
  );
}
