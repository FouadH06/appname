'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BookingDrawer } from '@/components/biz/booking-drawer';
import { NewAppointment, type FoundCustomer } from '@/components/biz/new-appointment';
import { Toasts, useToasts } from '@/components/biz/overlay';
import {
  Body,
  Field,
  Notice,
  PageHeader,
  Section,
  Toggle,
  btn,
  codeOf,
  input,
} from '@/components/biz/ui';
import { STATUS_LABEL, actions, priceText, type BookingCard } from '@/lib/biz/bookings';
import { reliabilityHint } from '@/lib/biz/calendar';
import { useBiz } from '@/lib/biz/context';
import { beirutToday, loadServices, loadStaff } from '@/lib/biz/data';
import { fmtBeirut } from '@/lib/biz/schedule';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

interface CustomerDetail {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    since: string;
    acquired_via: string;
    is_claimed: boolean;
    archived: boolean;
    is_blocked_online: boolean;
    reliability: string | null;
  };
  stats: {
    visits: number;
    lifetime_spend: number | null;
    average_spend: number | null;
    last_visit_at: string | null;
    first_visit_at: string | null;
    favorite_service: string | null;
    favorite_service_id: string | null;
    preferred_staff: string | null;
    preferred_staff_id: string | null;
    no_shows: number;
    cancellations: number;
    late_cancellations: number;
  } | null;
  upcoming: BookingCard[];
  history: BookingCard[];
  notes: {
    id: string;
    body: string;
    is_pinned: boolean;
    visible_to_staff: boolean;
    author: string;
    mine: boolean;
    created_at: string;
  }[];
}

const ACQUIRED: Record<string, string> = {
  marketplace: 'APP_NAME',
  business_link: 'Your booking link',
  manual: 'Added by you',
  import: 'Imported',
  walk_in: 'Walk-in',
};

const daysAgo = (iso: string | null) =>
  iso
    ? `${Math.max(0, Math.round((Date.parse(`${beirutToday()}T12:00:00Z`) - Date.parse(iso)) / 86_400_000))} days ago`
    : '—';

/** B7 Customer detail — everything this business knows about one customer. No reviews, ever. */
export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { business, location, role } = useBiz();
  const desk = role !== 'staff';
  const { toasts, push, dismiss } = useToasts();
  const { data, reload } = useLoad(async () => {
    const { data: d, error } = await supabase().rpc('biz_get_customer', {
      p_business_id: business.id,
      p_customer_id: customerId,
    });
    if (error) return { error: codeOf(error) } as const;
    return { detail: d as unknown as CustomerDetail } as const;
  }, [business.id, customerId]);
  const { data: meta } = useLoad(
    () => Promise.all([loadStaff(business.id), loadServices(business.id)]),
    [business.id],
  );
  const [booking, setBooking] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!data) return <p className="p-4 text-sm text-ink-500">Loading…</p>;
  if ('error' in data) {
    return (
      <>
        <PageHeader title="Customer" />
        <Body>
          <Notice tone="danger">
            {data.error === 'NOT_FOUND'
              ? 'This customer isn’t available.'
              : describeError(data.error ?? 'UNKNOWN')}
          </Notice>
          <Link className={btn.link} href={`/biz/${business.id}/customers`}>
            ← Customers
          </Link>
        </Body>
      </>
    );
  }
  const { customer: c, stats, upcoming, history, notes } = data.detail;
  const staff = (meta?.[0] ?? []).filter((s) => s.status === 'active');
  const found: FoundCustomer = {
    id: c.id,
    display_name: c.name,
    phone_e164: c.phone,
    visit_count: stats?.visits ?? 0,
    last_visit_at: stats?.last_visit_at ?? null,
    preferred_staff_id: stats?.preferred_staff_id ?? null,
    preferred_staff_name: stats?.preferred_staff ?? null,
    favorite_service_id: stats?.favorite_service_id ?? null,
    reliability_label: c.reliability ?? 'new_customer',
    is_blocked_online: c.is_blocked_online,
  };
  const digits = c.phone?.replace(/\D/g, '');

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.phone ? (
              <span className="font-mono" dir="ltr">
                {c.phone}
              </span>
            ) : null}
            {reliabilityHint(c.reliability) ? (
              <span
                title="Based on recent booking behavior on APP_NAME"
                className={`rounded px-1.5 py-0.5 text-xs text-white ${c.reliability === 'reliable' ? 'bg-success-600' : 'bg-warning-600'}`}
              >
                {reliabilityHint(c.reliability)}
              </span>
            ) : c.reliability ? (
              <span className="rounded bg-info-600 px-1.5 py-0.5 text-xs text-white">
                New customer
              </span>
            ) : null}
            <span>
              Customer since {fmtBeirut(c.since).split(',')[0]} ·{' '}
              {ACQUIRED[c.acquired_via] ?? c.acquired_via}
            </span>
          </span>
        }
        actions={
          <>
            {c.phone ? (
              <a className={btn.secondary} href={`tel:${c.phone}`}>
                Call
              </a>
            ) : null}
            {c.phone ? (
              <a
                className={btn.secondary}
                href={`https://wa.me/${digits}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
            ) : null}
            {desk && location ? (
              <button type="button" className={btn.primary} onClick={() => setNewOpen(true)}>
                New appointment
              </button>
            ) : null}
          </>
        }
      />
      <Body>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            {stats ? (
              <Section title="At a glance">
                <dl
                  className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"
                  data-testid="customer-stats"
                >
                  <Stat label="Visits" value={String(stats.visits)} />
                  {stats.lifetime_spend !== null ? (
                    <Stat label="Lifetime spend" value={`$${stats.lifetime_spend}`} />
                  ) : null}
                  {stats.average_spend !== null ? (
                    <Stat label="Average spend" value={`$${stats.average_spend}`} />
                  ) : null}
                  <Stat label="Last visit" value={daysAgo(stats.last_visit_at)} />
                  <Stat label="Favorite service" value={stats.favorite_service ?? '—'} />
                  <Stat label="Usually with" value={stats.preferred_staff ?? '—'} />
                  <Stat label="No-shows here" value={String(stats.no_shows)} />
                  <Stat label="Cancellations here" value={String(stats.cancellations)} />
                </dl>
              </Section>
            ) : null}

            <Notes
              businessId={business.id}
              customerId={c.id}
              desk={desk}
              notes={notes}
              onChanged={() => void reload()}
              onError={(e) => push({ text: e, tone: 'danger' })}
            />

            {desk ? (
              editing ? (
                <EditName
                  businessId={business.id}
                  id={c.id}
                  name={c.name}
                  phone={c.phone}
                  onDone={() => {
                    setEditing(false);
                    void reload();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className={btn.link + ' self-start'}
                  onClick={() => setEditing(true)}
                >
                  Edit name / phone
                </button>
              )
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <Section title="Upcoming">
              <BookingList rows={upcoming} empty="Nothing booked." onOpen={setBooking} />
            </Section>
            {desk ? (
              <Section title="History">
                <BookingList rows={history} empty="No visits yet." onOpen={setBooking} />
              </Section>
            ) : null}
          </div>
        </div>
      </Body>

      {booking ? (
        <BookingDrawer
          bookingId={booking}
          businessId={business.id}
          role={role}
          staffOptions={staff.map((s) => ({ id: s.id, display_name: s.display_name }))}
          onClose={() => setBooking(null)}
          onChanged={(msg) => {
            push({ text: msg });
            void reload();
          }}
        />
      ) : null}
      {newOpen && location ? (
        <NewAppointment
          businessId={business.id}
          locationId={location.id}
          role={role}
          myStaffId={null}
          staff={staff.map((s) => ({ id: s.id, display_name: s.display_name }))}
          services={meta?.[1] ?? []}
          prefill={{ date: beirutToday(), customer: found }}
          walkIn={false}
          onClose={() => setNewOpen(false)}
          onSaved={(saved, again) => {
            if (!again) setNewOpen(false);
            push(
              {
                text: `Saved · ${saved.summary}`,
                action: {
                  label: 'Undo',
                  run: () => void actions.undoManual(saved.bookingId).then(() => reload()),
                },
              },
              10_000,
            );
            void reload();
          }}
        />
      ) : null}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function BookingList({
  rows,
  empty,
  onOpen,
}: {
  rows: BookingCard[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return <p className="text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line-200 text-sm">
      {rows.map((b) => (
        <li key={b.item_id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 py-2 text-start hover:bg-surface-50"
            onClick={() => onOpen(b.booking_id)}
          >
            <span>
              <span className="font-medium">{fmtBeirut(b.starts_at)}</span> · {b.service_name} ·{' '}
              {b.staff_name}
            </span>
            <span className="shrink-0 text-xs text-ink-500">
              {priceText(b) ? `${priceText(b)} · ` : ''}
              {STATUS_LABEL[b.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Notes({
  businessId,
  customerId,
  desk,
  notes,
  onChanged,
  onError,
}: {
  businessId: string;
  customerId: string;
  desk: boolean;
  notes: CustomerDetail['notes'];
  onChanged: () => void;
  onError: (e: string) => void;
}) {
  const [body, setBody] = useState('');
  const [pin, setPin] = useState(false);
  const [forStaff, setForStaff] = useState(false);
  const call = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) onError(describeError(codeOf(error)));
    else onChanged();
  };
  return (
    <Section
      title="Notes"
      description="Private to your business. A pinned note shows on the calendar."
    >
      <ul className="flex flex-col gap-2 text-sm" data-testid="customer-notes">
        {notes.map((n) => (
          <li key={n.id} className="rounded-control bg-surface-50 p-2.5">
            <p>
              {n.is_pinned ? '📌 ' : ''}
              {n.body}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              {n.author} · {fmtBeirut(n.created_at)}
              {n.visible_to_staff ? ' · visible to staff' : ''}
              {desk ? (
                <>
                  <button
                    type="button"
                    className={btn.link + ' text-xs'}
                    onClick={() =>
                      void call(
                        supabase().rpc('biz_update_note', {
                          p_note_id: n.id,
                          p_body: n.body,
                          p_pinned: !n.is_pinned,
                          p_visible_to_staff: n.visible_to_staff,
                        }),
                      )
                    }
                  >
                    {n.is_pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button
                    type="button"
                    className={btn.link + ' text-xs'}
                    onClick={() =>
                      void call(supabase().rpc('biz_delete_note', { p_note_id: n.id }))
                    }
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </p>
          </li>
        ))}
        {!notes.length ? <li className="text-ink-500">No notes yet.</li> : null}
      </ul>
      {desk ? (
        <div className="flex flex-col gap-2">
          <Field label="Add a note">
            <textarea
              className={input + ' h-20 py-2'}
              value={body}
              maxLength={1000}
              placeholder="e.g. Allergic to ammonia dyes"
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <Toggle label="Pin (shows on the calendar)" checked={pin} onChange={setPin} />
          <Toggle label="Visible to staff" checked={forStaff} onChange={setForStaff} />
          <button
            type="button"
            className={btn.secondary + ' self-start'}
            disabled={!body.trim()}
            onClick={() =>
              void call(
                supabase().rpc('biz_add_note', {
                  p_business_id: businessId,
                  p_customer_id: customerId,
                  p_body: body.trim(),
                  p_pinned: pin,
                  p_visible_to_staff: forStaff,
                }),
              ).then(() => {
                setBody('');
                setPin(false);
                setForStaff(false);
              })
            }
          >
            Add note
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function EditName({
  businessId,
  id,
  name,
  phone,
  onDone,
}: {
  businessId: string;
  id: string;
  name: string;
  phone: string | null;
  onDone: () => void;
}) {
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone ?? '');
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title="Edit customer">
      <Field label="Name">
        <input className={input} value={n} maxLength={80} onChange={(e) => setN(e.target.value)} />
      </Field>
      <Field label="Phone">
        <input className={input} value={p} inputMode="tel" onChange={(e) => setP(e.target.value)} />
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          onClick={() =>
            void supabase()
              .rpc('biz_upsert_customer', {
                p_business_id: businessId,
                p_display_name: n,
                p_phone: p || undefined,
                p_id: id,
              })
              .then(({ error: err }) => (err ? setError(describeError(codeOf(err))) : onDone()))
          }
        >
          Save
        </button>
        <button type="button" className={btn.link} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Section>
  );
}
