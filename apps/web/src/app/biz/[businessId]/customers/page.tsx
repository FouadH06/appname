'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { parsePhone } from '@app/core';
import { Body, Field, Notice, PageHeader, Section, btn, codeOf, input } from '@/components/biz/ui';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

interface Row {
  id: string;
  display_name: string;
  phone_e164: string | null;
  visit_count: number;
  last_visit_at: string | null;
  lifetime_spend: number | null;
  preferred_staff_name: string | null;
  reliability_label: string | null;
  acquired_via: 'marketplace' | 'business_link' | 'manual' | 'import';
  total_count: number;
}

const LABEL: Record<string, string> = {
  new_customer: 'New customer',
  reliable: 'Reliable',
  some_missed_appointments: 'Some missed appointments',
};
const VIA: Record<Row['acquired_via'], string> = {
  marketplace: 'APP_NAME',
  business_link: 'Own link',
  manual: 'Added manually',
  import: 'Imported',
};
const PAGE = 50;

// B6 Customers (basic CRM): search, sort, add. Customer detail (B7) arrives with M6.
function Customers() {
  const { business, role } = useBiz();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [term, setTerm] = useState(q);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, reload } = useLoad(async () => {
    const { data: rows, error } = await supabase().rpc('biz_search_customers', {
      p_business_id: business.id,
      p_q: term || undefined,
      p_sort: sort,
      p_limit: PAGE,
      p_offset: page * PAGE,
    });
    if (error) throw error;
    return (rows ?? []) as unknown as Row[];
  }, [business.id, term, sort, page]);

  const total = data?.[0]?.total_count ?? 0;
  const desk = role !== 'staff';
  const showSpend = data?.some((r) => r.lifetime_spend !== null) ?? false;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={role === 'staff' ? 'Your upcoming customers' : `${total || 'No'} customers`}
        actions={
          desk ? (
            <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
              + Add customer
            </button>
          ) : null
        }
      />
      <Body>
        {adding ? (
          <AddCustomer
            businessId={business.id}
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
            onOpenExisting={(name) => {
              setAdding(false);
              setQ(name);
            }}
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <input
            className={input + ' max-w-sm'}
            placeholder="Search by name or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search customers"
          />
          <select
            className={input + ' w-44'}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sort"
          >
            <option value="recent">Last visit</option>
            <option value="name">Name</option>
            <option value="visits">Most visits</option>
            {showSpend ? <option value="spend">Lifetime spend</option> : null}
          </select>
        </div>

        {data && data.length === 0 ? (
          <Notice>
            {term
              ? `No customer matches “${term}”.`
              : 'Customers appear here after their first booking — online or added by you.'}
          </Notice>
        ) : null}

        {data && data.length > 0 ? (
          <div className="overflow-x-auto rounded-card border border-line-200 bg-surface-0">
            <table className="w-full text-sm" data-testid="customers-table">
              <thead className="text-start text-ink-500">
                <tr className="border-b border-line-200">
                  <th className="px-3 py-2 text-start font-medium">Name</th>
                  {desk ? <th className="px-3 py-2 text-start font-medium">Phone</th> : null}
                  <th className="px-3 py-2 text-start font-medium">Visits</th>
                  <th className="hidden px-3 py-2 text-start font-medium md:table-cell">
                    Last visit
                  </th>
                  {showSpend ? (
                    <th className="hidden px-3 py-2 text-start font-medium md:table-cell">Spend</th>
                  ) : null}
                  <th className="hidden px-3 py-2 text-start font-medium lg:table-cell">
                    Preferred
                  </th>
                  {desk ? (
                    <th className="hidden px-3 py-2 text-start font-medium lg:table-cell">
                      Reliability
                    </th>
                  ) : null}
                  {desk ? (
                    <th className="hidden px-3 py-2 text-start font-medium lg:table-cell">
                      Came via
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-line-200 last:border-0">
                    <td className="px-3 py-2 font-medium">{r.display_name}</td>
                    {desk ? (
                      <td className="px-3 py-2" dir="ltr">
                        {r.phone_e164 ? (
                          <a
                            className="text-accent-600"
                            href={`https://wa.me/${r.phone_e164.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {r.phone_e164}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                    <td className="px-3 py-2">{r.visit_count}</td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      {r.last_visit_at
                        ? new Intl.DateTimeFormat('en', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            timeZone: 'Asia/Beirut',
                          }).format(new Date(r.last_visit_at))
                        : '—'}
                    </td>
                    {showSpend ? (
                      <td className="hidden px-3 py-2 md:table-cell">
                        {r.lifetime_spend !== null ? `$${r.lifetime_spend}` : '—'}
                      </td>
                    ) : null}
                    <td className="hidden px-3 py-2 lg:table-cell">
                      {r.preferred_staff_name ?? '—'}
                    </td>
                    {desk ? (
                      <td className="hidden px-3 py-2 lg:table-cell">
                        {r.reliability_label ? LABEL[r.reliability_label] : '—'}
                      </td>
                    ) : null}
                    {desk ? (
                      <td className="hidden px-3 py-2 lg:table-cell">{VIA[r.acquired_via]}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {total > PAGE ? (
          <div className="flex items-center gap-3 text-sm">
            <button
              type="button"
              className={btn.secondary}
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <span>
              {page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}
            </span>
            <button
              type="button"
              className={btn.secondary}
              disabled={(page + 1) * PAGE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </Body>
    </>
  );
}

function AddCustomer({
  businessId,
  onDone,
  onCancel,
  onOpenExisting,
}: {
  businessId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
  onOpenExisting: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setDup(null);
    if (!name.trim()) return setError('Enter a name.');
    if (phone.trim() && !parsePhone(phone).ok) return setError('Check the phone number.');
    setBusy(true);
    const { error: err } = await supabase().rpc('biz_upsert_customer', {
      p_business_id: businessId,
      p_display_name: name,
      p_phone: phone.trim() || undefined,
    });
    setBusy(false);
    if (err) {
      if (codeOf(err) === 'DUPLICATE_CUSTOMER') {
        const detail = JSON.parse((err as { details?: string }).details ?? '{}') as {
          display_name?: string;
        };
        return setDup(detail.display_name ?? 'this customer');
      }
      return setError(describeError(codeOf(err)));
    }
    await onDone();
  };

  return (
    <Section title="New customer">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className={input}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Phone (optional)">
          <input
            className={input}
            type="tel"
            dir="ltr"
            placeholder="70 123 456"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
      {dup ? (
        <Notice tone="warning">
          Already a customer: {dup}.{' '}
          <button type="button" className={btn.link} onClick={() => onOpenExisting(dup)}>
            Open
          </button>
        </Notice>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
          Add customer
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Section>
  );
}

export default function CustomersPage() {
  return (
    <Suspense>
      <Customers />
    </Suspense>
  );
}
