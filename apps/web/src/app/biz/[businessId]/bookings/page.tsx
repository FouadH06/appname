'use client';

import { useDeferredValue, useState } from 'react';
import { BookingDrawer, bookingError } from '@/components/biz/booking-drawer';
import { Toasts, useToasts } from '@/components/biz/overlay';
import { PageHeader, btn, input } from '@/components/biz/ui';
import {
  SOURCE_ICON,
  SOURCE_LABEL,
  STATUS_LABEL,
  actions,
  listBookings,
  priceText,
  type BookingCard,
} from '@/lib/biz/bookings';
import { useBiz } from '@/lib/biz/context';
import { loadServices, loadStaff } from '@/lib/biz/data';
import { useBookingChanges } from '@/lib/biz/realtime';
import { fmtBeirut } from '@/lib/biz/schedule';
import { useLoad } from '@/lib/biz/use-load';
import { useNow } from '@/lib/biz/use-now';

type Tab = 'pending' | 'upcoming' | 'past' | 'cancelled';
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled & no-shows' },
];
const SOURCES = ['marketplace_search', 'business_link', 'rebook', 'manual', 'walk_in'];
const PAGE = 50;

function expiresIn(iso: string | null, now: number) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((Date.parse(iso) - now) / 60000));
  return m >= 60 ? `expires in ${Math.floor(m / 60)}h ${m % 60}m` : `expires in ${m}m`;
}

/** B5 Bookings — find a booking, process requests, review cancellations and no-shows. */
export default function BookingsPage() {
  const { business, role } = useBiz();
  const now = useNow();
  const { toasts, push, dismiss } = useToasts();
  const [chosen, setChosen] = useState<Tab | null>(null);
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [staffId, setStaffId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: meta } = useLoad(
    () => Promise.all([loadStaff(business.id), loadServices(business.id)]),
    [business.id],
  );
  const { data: pendingProbe, reload: reloadProbe } = useLoad(
    () => listBookings({ businessId: business.id, tab: 'pending', limit: 1 }),
    [business.id],
  );
  const tab: Tab = chosen ?? ((pendingProbe?.pending_count ?? 0) > 0 ? 'pending' : 'upcoming');
  const { data, reload } = useLoad(
    () =>
      listBookings({
        businessId: business.id,
        tab,
        q: query.trim() || null,
        staffId: staffId || null,
        serviceId: serviceId || null,
        source: source || null,
        from: from || null,
        to: to || null,
        limit: PAGE,
        offset: page * PAGE,
      }),
    [business.id, tab, query, staffId, serviceId, source, from, to, page],
  );
  const refresh = () => {
    void reload();
    void reloadProbe();
  };
  useBookingChanges(business.id, refresh);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      push({ text: msg });
      refresh();
    } catch (e) {
      push({ text: bookingError(e).text, tone: 'danger' });
    }
  };

  const rows: BookingCard[] = data?.rows ?? [];
  const unmarked = tab === 'past' ? rows.filter((r) => r.status === 'confirmed') : [];
  const staff = (meta?.[0] ?? []).filter((s) => s.status === 'active');
  const pendingCount = data?.pending_count ?? pendingProbe?.pending_count ?? 0;

  return (
    <>
      <PageHeader title="Bookings" subtitle="Requests, upcoming and past appointments." />
      <div className="flex flex-col gap-3 p-4 md:p-6">
        <div className="flex flex-wrap gap-1 border-b border-line-200" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-accent-600 text-accent-600' : 'border-transparent text-ink-500'}`}
              onClick={() => {
                setChosen(t.key);
                setPage(0);
              }}
            >
              {t.label}
              {t.key === 'pending' && pendingCount ? ` (${pendingCount})` : ''}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <input
            className={input + ' lg:col-span-2'}
            placeholder="Name, phone or booking ref"
            aria-label="Search bookings"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
          <select
            className={input}
            aria-label="Staff"
            value={staffId}
            onChange={(e) => {
              setStaffId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All staff</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </select>
          <select
            className={input}
            aria-label="Service"
            value={serviceId}
            onChange={(e) => {
              setServiceId(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All services</option>
            {(meta?.[1] ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            className={input}
            aria-label="Source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="date"
              className={input}
              aria-label="From"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
            <input
              type="date"
              className={input}
              aria-label="To"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        {unmarked.length ? (
          <div className="flex items-center gap-3 rounded-control bg-surface-50 px-3 py-2 text-sm">
            {unmarked.length} not marked yet.
            <button
              type="button"
              className={btn.link}
              onClick={() =>
                void act(
                  () => actions.completeMany(unmarked.map((r) => r.booking_id)),
                  'Marked completed',
                )
              }
            >
              Mark all completed
            </button>
          </div>
        ) : null}

        {!data ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : !rows.length ? (
          <p className="rounded-card border border-line-200 bg-surface-0 p-6 text-center text-sm text-ink-500">
            {tab === 'pending'
              ? 'No requests waiting.'
              : tab === 'upcoming'
                ? 'No upcoming bookings.'
                : 'Nothing here.'}
          </p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-line-200 rounded-card border border-line-200 bg-surface-0"
            data-testid="bookings-list"
          >
            {rows.map((r) => (
              <li key={r.item_id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
                <button
                  type="button"
                  className="grid flex-1 gap-1 text-start text-sm md:grid-cols-[10rem_1fr_1fr_8rem]"
                  onClick={() => setOpen(r.booking_id)}
                >
                  <span className="font-medium">{fmtBeirut(r.starts_at)}</span>
                  <span className="truncate">
                    {r.customer?.name ?? 'Walk-in'}
                    {r.requested ? <span className="ms-1 text-star-500">★</span> : null}
                  </span>
                  <span className="truncate text-ink-500">
                    {r.service_name} · {r.staff_name}
                  </span>
                  <span className="text-xs text-ink-500">
                    {SOURCE_ICON[r.source] ?? ''} {STATUS_LABEL[r.status]}
                    {priceText(r) ? ` · ${priceText(r)}` : ''}
                  </span>
                </button>
                {r.status === 'pending' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-warning-600">{expiresIn(r.expires_at, now)}</span>
                    <button
                      type="button"
                      className={btn.primary}
                      onClick={() =>
                        void act(() => actions.accept(r.booking_id), 'Request accepted')
                      }
                    >
                      Accept
                    </button>
                    {declining === r.booking_id ? (
                      <>
                        <input
                          className={input + ' w-48'}
                          placeholder="Reason (optional)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button
                          type="button"
                          className={btn.danger}
                          onClick={() =>
                            void act(
                              () => actions.decline(r.booking_id, reason.trim()),
                              'Request declined',
                            ).then(() => {
                              setDeclining(null);
                              setReason('');
                            })
                          }
                        >
                          Decline
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={btn.secondary}
                        onClick={() => setDeclining(r.booking_id)}
                      >
                        Decline
                      </button>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {data && data.total > PAGE ? (
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
              {page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}
            </span>
            <button
              type="button"
              className={btn.secondary}
              disabled={(page + 1) * PAGE >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <BookingDrawer
          bookingId={open}
          businessId={business.id}
          role={role}
          staffOptions={staff.map((s) => ({ id: s.id, display_name: s.display_name }))}
          onClose={() => setOpen(null)}
          onChanged={(msg) => {
            push({ text: msg });
            refresh();
          }}
        />
      ) : null}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}
