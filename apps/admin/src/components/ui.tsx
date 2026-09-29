'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MyAccess } from '@app/api';
import { messageForCode } from '@app/i18n';
import {
  BUSINESS_ROLES,
  CATALOG_ROLES,
  CUSTOMER_ROLES,
  DISPUTE_ROLES,
  MODERATION_ROLES,
  RANKING_ROLES,
  REVIEW_ROLES,
  canSee,
} from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// Small admin UI kit (M11): shell with role-aware nav + global search, data hook, table, reason dialog.
// Desktop-only console (≥1280, Phase 2 Part 4); practical over pretty.

export const field = 'w-full rounded-control border border-line-200 bg-surface-0 px-3 py-2 text-sm';
export const btn = {
  primary:
    'h-9 rounded-control bg-accent-600 px-3 text-sm font-semibold text-white disabled:opacity-50',
  secondary:
    'h-9 rounded-control border border-line-200 px-3 text-sm font-medium disabled:opacity-50',
  danger:
    'h-9 rounded-control bg-danger-600 px-3 text-sm font-semibold text-white disabled:opacity-50',
};

export const errorText = (e: { message: string } | null | undefined) =>
  e ? messageForCode('en', e.message) : null;

export function fmt(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Asia/Beirut',
  }).format(new Date(iso));
}

export const statusTone = (s: string): 'neutral' | 'good' | 'warn' | 'bad' =>
  ['live', 'active', 'published', 'approved', 'resolved', 'verified'].includes(s)
    ? 'good'
    : ['suspended', 'closed', 'removed', 'rejected', 'quarantined', 'blocked'].includes(s)
      ? 'bad'
      : [
            'paused',
            'warned',
            'pending',
            'awaiting_info',
            'open',
            'manual_review',
            'restricted',
            'some_missed',
          ].includes(s)
        ? 'warn'
        : 'neutral';

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1
    ? `${Math.max(1, Math.round(h * 60))} min`
    : h < 48
      ? `${Math.round(h)} h`
      : `${Math.round(h / 24)} d`;
}

/** Loads an RPC result; `reload()` after a mutation. Keeps the last data while reloading. */
export function useData<T>(
  load: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  deps: readonly unknown[],
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const apply = useCallback((r: { data: unknown; error: { message: string } | null }) => {
    setLoading(false);
    if (r.error) setError(errorText(r.error));
    else {
      setError(null);
      setData(r.data as T);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void loadRef.current().then((r) => {
      if (alive) apply(r);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the load inputs as deps
  }, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    apply(await loadRef.current());
  }, [apply]);
  return { data, error, loading, reload };
}

const NAV: [string, string, readonly string[]][] = [
  ['/', 'Overview', []],
  ['/moderation', 'Moderation', MODERATION_ROLES],
  ['/businesses', 'Businesses', BUSINESS_ROLES],
  ['/customers', 'Customers', CUSTOMER_ROLES],
  ['/reviews', 'Reviews', REVIEW_ROLES],
  ['/disputes', 'Disputes', DISPUTE_ROLES],
  ['/catalog', 'Catalog', CATALOG_ROLES],
  ['/ranking', 'Ranking', RANKING_ROLES],
  ['/audit', 'Audit log', []],
];

export function Shell({
  access,
  title,
  actions,
  children,
}: {
  access: MyAccess;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  return (
    <div className="min-h-screen bg-surface-50">
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-line-200 bg-surface-0 px-4 py-2">
        <Link href="/" className="font-semibold">
          APP_NAME Admin
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm" aria-label="Admin">
          {NAV.filter(([, , roles]) => canSee(access.admin_role, roles)).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-control px-2 py-1 ${
                (href === '/' ? path === '/' : path.startsWith(href))
                  ? 'bg-accent-600 text-white'
                  : 'hover:bg-surface-100'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <GlobalSearch />
        <span className="text-xs text-ink-500">{access.admin_role}</span>
        <button
          type="button"
          className="text-xs text-ink-500 hover:underline"
          onClick={() =>
            void supabase()
              .auth.signOut()
              .then(() => router.replace('/login'))
          }
        >
          Sign out
        </button>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="ms-auto flex gap-2">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

interface SearchHits {
  businesses: { id: string; name: string; slug: string; status: string }[];
  customers: { id: string; name: string | null; phone: string | null; status: string }[];
  bookings: {
    id: string;
    ref: string;
    business_id: string;
    status: string;
    customer_user_id: string | null;
  }[];
}

/** Header search: businesses, customers (support/superadmin), bookings by reference. */
function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHits | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = window.setTimeout(() => {
      void supabase()
        .rpc('admin_search', { p_q: q.trim() })
        .then(({ data }) => setHits((data as unknown as SearchHits) ?? null));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const open = q.trim().length >= 2 && hits;
  const count = hits ? hits.businesses.length + hits.customers.length + hits.bookings.length : 0;
  return (
    <div className="relative ms-auto w-72">
      <input
        className={field}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search business, phone, booking ref"
        aria-label="Global search"
        data-testid="global-search"
      />
      {open ? (
        <div
          className="absolute end-0 top-11 z-30 w-96 rounded-card border border-line-200 bg-surface-0 p-2 text-sm shadow-lg"
          data-testid="search-results"
          onClick={() => setQ('')}
        >
          {count === 0 ? <p className="p-2 text-ink-500">No matches.</p> : null}
          {hits.businesses.map((b) => (
            <Link
              key={b.id}
              href={`/businesses/${b.id}`}
              className="block rounded p-2 hover:bg-surface-100"
            >
              🏪 {b.name} <span className="text-ink-500">· {b.status}</span>
            </Link>
          ))}
          {hits.customers.map((c) => (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="block rounded p-2 hover:bg-surface-100"
            >
              👤 {c.name ?? 'No name'}{' '}
              <span className="text-ink-500">
                · {c.phone} · {c.status}
              </span>
            </Link>
          ))}
          {hits.bookings.map((k) => (
            <Link
              key={k.id}
              href={
                k.customer_user_id
                  ? `/customers/${k.customer_user_id}`
                  : `/businesses/${k.business_id}`
              }
              className="block rounded p-2 hover:bg-surface-100"
            >
              📅 Booking {k.ref} <span className="text-ink-500">· {k.status}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function State({
  loading,
  error,
  empty,
  emptyText = 'Nothing here.',
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyText?: string;
}) {
  if (error)
    return (
      <p className="text-sm text-danger-600" role="alert">
        {error}
      </p>
    );
  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (empty)
    return (
      <p className="text-sm text-ink-700" data-testid="empty">
        {emptyText}
      </p>
    );
  return null;
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line-200 bg-surface-0 p-4">
      {title || actions ? (
        <div className="mb-3 flex items-center gap-2">
          {title ? <h2 className="font-medium">{title}</h2> : null}
          <div className="ms-auto flex gap-2">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const c = {
    neutral: 'border border-line-200 bg-surface-100 text-ink-700',
    good: 'border border-success-600 text-success-600',
    warn: 'border border-warning-600 text-warning-600',
    bad: 'border border-danger-600 text-danger-600',
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${c}`}>{children}</span>;
}

/** Plain table: columns = [header, render]. Rows link when `href` is given. */
export function Table<T>({
  rows,
  cols,
  href,
  testId,
}: {
  rows: T[];
  cols: [string, (r: T) => ReactNode][];
  href?: (r: T) => string;
  testId?: string;
}) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto rounded-card border border-line-200 bg-surface-0">
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="bg-surface-50 text-left text-xs text-ink-500">
          <tr>
            {cols.map(([h]) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-200">
          {rows.map((r, i) => (
            <tr
              key={i}
              className={href ? 'cursor-pointer hover:bg-surface-50' : ''}
              onClick={href ? () => router.push(href(r)) : undefined}
              data-testid={testId ? `${testId}-row` : undefined}
            >
              {cols.map(([h, render]) => (
                <td key={h} className="px-3 py-2 align-top">
                  {render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Confirm + reason code (+ optional note and extra inputs) for every mutating admin action.
 * `run` returns the RPC's error; the dialog stays open and shows it on failure.
 */
export function ActionDialog({
  label,
  title,
  reasons,
  danger,
  confirmText,
  children,
  run,
  onDone,
  testId,
  disabled,
}: {
  label: string;
  title: string;
  reasons: string[];
  danger?: boolean;
  confirmText?: string;
  children?: ReactNode;
  run: (reason: string, note: string) => PromiseLike<{ error: { message: string } | null }>;
  onDone?: () => void;
  testId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setReason('');
    setNote('');
    setError(null);
  };
  return (
    <>
      <button
        type="button"
        className={danger ? btn.danger : btn.secondary}
        onClick={() => setOpen(true)}
        disabled={disabled}
        data-testid={testId}
      >
        {label}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-label={title}
        >
          <div className="flex w-full max-w-md flex-col gap-3 rounded-card bg-surface-0 p-5 shadow-xl">
            <h2 className="font-semibold">{title}</h2>
            {children}
            <select
              className={field}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-label="Reason code"
            >
              <option value="">Reason code…</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <textarea
              className={`${field} h-20`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional, kept in the audit log)"
              aria-label="Note"
            />
            {error ? (
              <p className="text-sm text-danger-600" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn.secondary} onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className={danger ? btn.danger : btn.primary}
                disabled={!reason || busy}
                data-testid="confirm-action"
                onClick={() => {
                  setBusy(true);
                  void run(reason, note.trim()).then(({ error: e }) => {
                    setBusy(false);
                    if (e) setError(errorText(e));
                    else {
                      close();
                      onDone?.();
                    }
                  });
                }}
              >
                {confirmText ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** "Audit trail" link: the unified log filtered to one subject or business (≤ 3 clicks, DoD). */
export function AuditLink({
  subjectId,
  businessId,
  label = 'Audit trail',
}: {
  subjectId?: string;
  businessId?: string;
  label?: string;
}) {
  const q = new URLSearchParams();
  if (subjectId) q.set('subject_id', subjectId);
  if (businessId) q.set('business_id', businessId);
  return (
    <Link
      href={`/audit?${q.toString()}`}
      className="text-sm text-accent-600"
      data-testid="audit-link"
    >
      {label} →
    </Link>
  );
}
