'use client';

import { useState } from 'react';
import { Body, Notice, PageHeader, Section, codeOf } from '@/components/biz/ui';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

// B11 Analytics (MUST scope): period → KPI tiles vs previous period → daily trend → top services →
// staff table → source mix. Numbers come from bookings (daily rollups + today live). Reception sees
// counts only; revenue is "estimated" when prices are "from" / ranges. Beirut days.

type Period = 'today' | '7d' | '30d' | 'month';
interface Kpis {
  revenue_min: number | null;
  revenue_max: number | null;
  completed: number;
  created: number;
  customers: number;
  new_customers: number;
  returning_customers: number;
  avg_value: number | null;
  cancellation_rate: number | null;
  no_show_rate: number | null;
  utilization: number | null;
}
interface Analytics {
  period: { from: string; to: string };
  show_revenue: boolean;
  enough_data: boolean;
  estimated: boolean;
  kpis: { cur: Kpis; prev: Kpis };
  series: { day: string; completed: number; revenue: number | null }[];
  sources: { marketplace: number; business_link: number; manual: number; rebook: number };
  services: { service_id: string; name: string; completed: number; revenue: number | null }[];
  staff: {
    staff_id: string;
    name: string;
    archived: boolean;
    completed: number;
    revenue: number | null;
    utilization: number | null;
    requested: number;
    no_shows: number;
  }[];
}

const PERIODS: [Period, string][] = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['month', 'This month'],
];

/** Beirut calendar date (YYYY-MM-DD) n days from today */
function beirut(offset = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
}
function range(p: Period): [string, string] {
  const today = beirut();
  if (p === 'today') return [today, today];
  if (p === '7d') return [beirut(-6), today];
  if (p === '30d') return [beirut(-29), today];
  return [`${today.slice(0, 8)}01`, today];
}

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `$${Math.round(Number(v)).toLocaleString('en-US')}`;
const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`;
const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${ymd}T12:00:00Z`),
  );

function change(cur: number | null, prev: number | null, lowerIsBetter = false) {
  if (cur === null || prev === null || prev === 0) return null;
  const d = (cur - prev) / prev;
  if (Math.abs(d) < 0.005) return <span className="text-ink-500">same as before</span>;
  const good = lowerIsBetter ? d < 0 : d > 0;
  return (
    <span className={good ? 'text-success-600' : 'text-danger-600'}>
      {d > 0 ? '▲' : '▼'} {Math.abs(Math.round(d * 100))}% vs previous
    </span>
  );
}

function Tile({
  label,
  value,
  info,
  delta,
}: {
  label: string;
  value: string;
  info: string;
  delta?: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-line-200 bg-surface-0 p-3" data-testid="kpi">
      <div className="flex items-center justify-between gap-2 text-xs text-ink-500">
        <span>{label}</span>
        <span title={info} aria-label={info} className="cursor-help">
          ⓘ
        </span>
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
      <div className="mt-0.5 min-h-4 text-xs">{delta}</div>
    </div>
  );
}

export default function AnalyticsPage() {
  const { business } = useBiz();
  const [period, setPeriod] = useState<Period>('7d');
  const [from, to] = range(period);
  const { data } = useLoad(async () => {
    const { data: d, error } = await supabase().rpc('biz_get_analytics', {
      p_business_id: business.id,
      p_from: from,
      p_to: to,
    });
    return error ? { error: describeError(codeOf(error)) } : { value: d as unknown as Analytics };
  }, [business.id, from, to]);

  const a = data && 'value' in data ? data.value : null;
  const c = a?.kpis.cur;
  const p = a?.kpis.prev;
  const maxDay = Math.max(1, ...(a?.series.map((s) => s.completed) ?? [1]));
  const srcTotal = a
    ? a.sources.marketplace + a.sources.business_link + a.sources.manual + a.sources.rebook
    : 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="From your bookings. Beirut time."
        actions={
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Period">
            {PERIODS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={period === k}
                onClick={() => setPeriod(k)}
                className={`h-9 rounded-control px-3 text-sm ${period === k ? 'bg-accent-600 text-white' : 'border border-line-200 bg-surface-0'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      <Body>
        {data && 'error' in data ? <Notice tone="danger">{data.error}</Notice> : null}
        {!data ? <p className="text-sm text-ink-500">Loading…</p> : null}
        {a && c && p ? (
          <div className="flex flex-col gap-4" data-testid="analytics">
            {!a.enough_data ? (
              <Notice>
                Analytics fill in after your first week of bookings. Here&apos;s what&apos;s
                available so far.
              </Notice>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {a.show_revenue ? (
                <Tile
                  label={a.estimated ? 'Revenue (estimated)' : 'Revenue'}
                  value={money(c.revenue_min)}
                  info="Sum of completed booking prices. “From” and range prices use the lowest price. Actual cash may differ."
                  delta={change(c.revenue_min, p.revenue_min)}
                />
              ) : null}
              <Tile
                label="Completed bookings"
                value={String(c.completed)}
                info="Appointments in this period marked completed."
                delta={change(c.completed, p.completed)}
              />
              <Tile
                label="Customers"
                value={String(c.customers)}
                info="Different customers with a completed appointment in this period."
                delta={change(c.customers, p.customers)}
              />
              <Tile
                label="New · returning"
                value={`${c.new_customers} · ${c.returning_customers}`}
                info="New = their first completed visit with you happened in this period."
              />
              {a.show_revenue ? (
                <Tile
                  label="Average booking"
                  value={money(c.avg_value)}
                  info="Revenue divided by completed bookings."
                  delta={change(c.avg_value, p.avg_value)}
                />
              ) : null}
              <Tile
                label="Cancellation rate"
                value={pct(c.cancellation_rate)}
                info="Cancelled bookings (by you or the customer) divided by bookings made in this period."
                delta={change(c.cancellation_rate, p.cancellation_rate, true)}
              />
              <Tile
                label="No-show rate"
                value={pct(c.no_show_rate)}
                info="No-shows divided by completed + no-show appointments."
                delta={change(c.no_show_rate, p.no_show_rate, true)}
              />
              <Tile
                label="Utilization"
                value={pct(c.utilization)}
                info="Booked appointment time divided by your team's working hours."
                delta={change(c.utilization, p.utilization)}
              />
            </div>

            <Section title="Completed bookings by day">
              {a.series.length ? (
                <div
                  className="flex h-40 items-end gap-1"
                  role="img"
                  aria-label="Completed bookings by day"
                  data-testid="trend"
                >
                  {a.series.map((s) => (
                    <div
                      key={s.day}
                      className="flex min-w-0 flex-1 flex-col items-center gap-1"
                      title={`${dayLabel(s.day)}: ${s.completed} completed${s.revenue !== null ? ` · ${money(s.revenue)}` : ''}`}
                    >
                      <div
                        className="w-full rounded-t bg-accent-600"
                        style={{ height: `${Math.max(2, (s.completed / maxDay) * 128)}px` }}
                      />
                      {a.series.length <= 14 ? (
                        <span className="truncate text-[10px] text-ink-500">{dayLabel(s.day)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-500">No days in this period yet.</p>
              )}
            </Section>

            <div className="grid gap-4 md:grid-cols-2">
              <Section title="Top services">
                {a.services.length ? (
                  <ul className="flex flex-col gap-2 text-sm" data-testid="top-services">
                    {a.services.slice(0, 5).map((s) => (
                      <li key={s.service_id} className="flex justify-between gap-2">
                        <span>{s.name}</span>
                        <span className="text-ink-500">
                          {s.completed}
                          {a.show_revenue ? ` · ${money(s.revenue)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-500">No completed bookings yet.</p>
                )}
              </Section>
              <Section
                title="Where bookings come from"
                description="Completed bookings by source — shows what APP_NAME brings you."
              >
                <ul className="flex flex-col gap-2 text-sm" data-testid="source-mix">
                  {(
                    [
                      ['APP_NAME marketplace', a.sources.marketplace],
                      ['Your booking link', a.sources.business_link],
                      ['Rebooked', a.sources.rebook],
                      ['Added by you (calls, walk-ins)', a.sources.manual],
                    ] as [string, number][]
                  ).map(([label, n]) => (
                    <li key={label} className="flex flex-col gap-1">
                      <div className="flex justify-between">
                        <span>{label}</span>
                        <span className="text-ink-500">
                          {n}
                          {srcTotal ? ` · ${Math.round((n / srcTotal) * 100)}%` : ''}
                        </span>
                      </div>
                      <div className="h-1.5 rounded bg-surface-100">
                        <div
                          className="h-1.5 rounded bg-accent-600"
                          style={{ width: `${srcTotal ? (n / srcTotal) * 100 : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>

            <Section title="Team">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="staff-table">
                  <thead className="text-left text-xs text-ink-500">
                    <tr>
                      <th className="py-1 pe-3 font-medium">Name</th>
                      <th className="py-1 pe-3 font-medium">Completed</th>
                      {a.show_revenue ? <th className="py-1 pe-3 font-medium">Revenue</th> : null}
                      <th className="py-1 pe-3 font-medium">Utilization</th>
                      <th className="py-1 pe-3 font-medium">Requested by name</th>
                      <th className="py-1 font-medium">No-shows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.staff.map((s) => (
                      <tr key={s.staff_id} className="border-t border-line-200">
                        <td className="py-2 pe-3">
                          {s.name}
                          {s.archived ? <span className="text-ink-500"> (former)</span> : null}
                        </td>
                        <td className="py-2 pe-3">{s.completed}</td>
                        {a.show_revenue ? <td className="py-2 pe-3">{money(s.revenue)}</td> : null}
                        <td className="py-2 pe-3">{pct(s.utilization)}</td>
                        <td className="py-2 pe-3">{s.requested}</td>
                        <td className="py-2">{s.no_shows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        ) : null}
      </Body>
    </>
  );
}
