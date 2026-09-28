'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Enums, Tables } from '@app/db';
import { AffectedBookings } from '@/components/biz/affected-bookings';
import { BookingDrawer } from '@/components/biz/booking-drawer';
import { HoursGrid } from '@/components/biz/hours-grid';
import { InviteShare } from '@/components/biz/sections/team';
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
import {
  STATUS_LABEL,
  affectedBookings,
  listBookings,
  priceText,
  type BookingCard,
} from '@/lib/biz/bookings';
import { canManage, useBiz } from '@/lib/biz/context';
import {
  beirutToday,
  loadMedia,
  loadServices,
  loadStaffWeek,
  publicMediaUrl,
  saveStaffWeek,
  uploadMedia,
  type Media,
  type Service,
  type Staff,
} from '@/lib/biz/data';
import {
  beirutDays,
  beirutToUtc,
  fmtBeirut,
  outsideWeek,
  overlapping,
  type StaffBooking,
} from '@/lib/biz/schedule';
import { fromHHMM, label12, toHHMM, weekErrors, type WeekHours } from '@/lib/biz/time';
import { describeError } from '@/lib/copy';
import { useLoad } from '@/lib/biz/use-load';
import { supabase } from '@/lib/supabase';

type Tab = 'profile' | 'services' | 'schedule' | 'bookings' | 'access';
const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'services', label: 'Services' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'access', label: 'Access' },
];

// B9 staff detail: Profile · Services · Schedule · Bookings · Access
export function StaffDetail({ staffId }: { staffId: string }) {
  const { business, role } = useBiz();
  const { data: staff, reload } = useLoad(async () => {
    const { data } = await supabase()
      .from('staff_members')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();
    return data ?? null;
  }, [staffId]);
  const [tab, setTab] = useState<Tab>('profile');
  const [error, setError] = useState<string | null>(null);

  if (!staff) return <PageHeader title="Staff" subtitle="Loading…" />;
  const manage = canManage(role);

  return (
    <>
      <PageHeader
        title={staff.display_name}
        subtitle={
          <>
            <Link href={`/biz/${business.id}/staff`} className={btn.link}>
              ← Staff
            </Link>{' '}
            {staff.status === 'archived'
              ? '· Former team member'
              : staff.role_title
                ? `· ${staff.role_title}`
                : ''}
          </>
        }
      />
      <div className="border-b border-line-200 bg-surface-0 px-4 md:px-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className="border-b-2 border-transparent px-3 py-2 text-sm aria-selected:border-accent-600 aria-selected:font-semibold"
          >
            {t.label}
          </button>
        ))}
      </div>
      <Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {!manage ? <Notice>View only. Owners and managers can change team settings.</Notice> : null}
        {tab === 'profile' ? (
          <ProfileTab staff={staff} manage={manage} onSaved={reload} onError={setError} />
        ) : null}
        {tab === 'services' ? (
          <ServicesTab staff={staff} manage={manage} onError={setError} />
        ) : null}
        {tab === 'schedule' ? (
          <ScheduleTab staff={staff} manage={manage} onError={setError} />
        ) : null}
        {tab === 'bookings' ? <BookingsTab staff={staff} /> : null}
        {tab === 'access' ? (
          <AccessTab staff={staff} manage={manage} onChanged={reload} onError={setError} />
        ) : null}
      </Body>
    </>
  );
}

// ─── Profile ───────────────────────────────────────────────────────────────
function ProfileTab({
  staff,
  manage,
  onSaved,
  onError,
}: {
  staff: Staff;
  manage: boolean;
  onSaved: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { business } = useBiz();
  const [name, setName] = useState(staff.display_name);
  const [title, setTitle] = useState(staff.role_title ?? '');
  const [bio, setBio] = useState(staff.bio ?? '');
  const [isPublic, setIsPublic] = useState(staff.publicly_bookable);
  const [auto, setAuto] = useState(staff.accepts_any_assignment);
  const [priority, setPriority] = useState(staff.assignment_priority);
  const { data: media } = useLoad(
    () => loadMedia(business.id),
    [business.id, staff.photo_media_id],
  );
  const photo: Media | null = media?.find((x) => x.id === staff.photo_media_id) ?? null;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blocking, setBlocking] = useState<BookingCard[] | null>(null);

  const archive = async () => {
    const { error } = await supabase().rpc('archive_staff', { p_staff_id: staff.id });
    if (error) throw error;
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    setSaved(false);
    try {
      await fn();
      await onSaved();
      setSaved(true);
    } catch (e) {
      const code = codeOf(e);
      if (code === 'STAFF_HAS_FUTURE_BOOKINGS') {
        // walk through their upcoming bookings (reassign / cancel), then archive
        setBlocking(await affectedBookings(staff.id).catch(() => []));
        onError(
          `${staff.display_name} still has upcoming bookings. Reassign or cancel them to archive.`,
        );
      } else onError(describeError(code));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!name.trim()) throw { message: 'NAME_REQUIRED' };
      const { error } = await supabase()
        .from('staff_members')
        .update({
          display_name: name.trim(),
          role_title: title.trim() || null,
          bio: bio.trim() || null,
          publicly_bookable: isPublic,
          accepts_any_assignment: isPublic && auto,
          assignment_priority: priority,
        })
        .eq('id', staff.id);
      if (error) throw error;
    });

  return (
    <>
      {blocking?.length ? (
        <AffectedBookings
          title={`${staff.display_name}'s upcoming bookings`}
          bookings={blocking}
          reason="Staff member no longer available"
          onDone={() => {
            setBlocking(null);
            void run(archive); // anything kept brings the list back
          }}
        />
      ) : null}
      <Section title="Profile">
        <div className="flex items-center gap-4">
          {photo?.path ? (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
            <img
              src={publicMediaUrl(photo.path)}
              alt=""
              className="size-16 rounded-full object-cover"
            />
          ) : (
            <span className="grid size-16 place-items-center rounded-full bg-surface-100 text-xl font-semibold">
              {staff.display_name.slice(0, 1)}
            </span>
          )}
          {manage ? (
            <label className={btn.secondary + ' cursor-pointer'}>
              {photo ? 'Change photo' : 'Add photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void run(() => uploadMedia(business.id, f, 'staff_photo', staff.id));
                }}
              />
            </label>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={input}
              value={name}
              disabled={!manage}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Role / title">
            <input
              className={input}
              value={title}
              disabled={!manage}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Short bio">
          <textarea
            className={input + ' h-20 py-2'}
            value={bio}
            maxLength={300}
            disabled={!manage}
            onChange={(e) => setBio(e.target.value)}
          />
        </Field>
        <Toggle
          label="Publicly bookable"
          description="On: customers can see and choose this person online. Off: internal only, never shown to customers."
          checked={isPublic}
          disabled={!manage}
          onChange={(v) => {
            setIsPublic(v);
            if (!v) setAuto(false);
          }}
        />
        <Toggle
          label="Accept automatic assignment"
          description={
            'Off: bookable only when a customer chooses them (e.g. the owner or a senior colorist).'
          }
          checked={auto}
          disabled={!manage || !isPublic}
          onChange={setAuto}
        />
        <Field
          label="Assignment priority"
          hint={'Lower goes first when the rule is "Priority order".'}
        >
          <input
            className={input + ' w-24'}
            type="number"
            min={0}
            max={999}
            value={priority}
            disabled={!manage}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </Field>
        {manage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={busy}
              onClick={() => void save()}
            >
              Save
            </button>
            {saved ? <span className="text-sm text-success-600">Saved</span> : null}
            <span className="flex-1" />
            {staff.status === 'active' ? (
              <button
                type="button"
                className={btn.danger}
                disabled={busy}
                onClick={() => void run(archive)}
              >
                Archive
              </button>
            ) : (
              <button
                type="button"
                className={btn.secondary}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { error } = await supabase().rpc('restore_staff', {
                      p_staff_id: staff.id,
                    });
                    if (error) throw error;
                  })
                }
              >
                Restore
              </button>
            )}
          </div>
        ) : null}
      </Section>
    </>
  );
}

// ─── Services with per-staff overrides and specialties ─────────────────────
type Link = Tables<'staff_services'>;

function ServicesTab({
  staff,
  manage,
  onError,
}: {
  staff: Staff;
  manage: boolean;
  onError: (e: string | null) => void;
}) {
  const { business } = useBiz();
  const { data, reload } = useLoad(
    () =>
      Promise.all([
        loadServices(business.id),
        supabase()
          .from('staff_services')
          .select('*')
          .eq('staff_id', staff.id)
          .then((r) => r.data ?? []),
      ]),
    [business.id, staff.id],
  );
  const services: Service[] = (data?.[0] ?? []).filter((s) => s.status === 'active');
  const links: Link[] = data?.[1] ?? [];
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setBusy(true);
    onError(null);
    const { error } = await fn();
    if (error) onError(describeError(codeOf(error)));
    await reload();
    setBusy(false);
  };

  const specialties = links.filter((l) => l.is_specialty).length;

  return (
    <Section
      title="Services"
      description="Unchecked services never show this person or produce availability. Overrides change price/duration for this person only."
    >
      <ul className="flex flex-col divide-y divide-line-200">
        {services.map((s) => {
          const l = links.find((x) => x.service_id === s.id);
          return (
            <li key={s.id} className="flex flex-col gap-2 py-3 text-sm">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={!!l}
                  disabled={!manage || busy}
                  onChange={(e) =>
                    void run(async () =>
                      e.target.checked
                        ? await supabase().from('staff_services').insert({
                            staff_id: staff.id,
                            service_id: s.id,
                            business_id: business.id,
                          })
                        : await supabase()
                            .from('staff_services')
                            .delete()
                            .eq('staff_id', staff.id)
                            .eq('service_id', s.id),
                    )
                  }
                />
                {s.name}
                <span className="font-normal text-ink-500">
                  ({s.duration_min} min, ${s.price_min ?? '—'})
                </span>
              </label>
              {l ? (
                <OverrideRow
                  link={l}
                  service={s}
                  manage={manage}
                  specialtiesFull={specialties >= 3}
                  onSave={run}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function OverrideRow({
  link,
  service,
  manage,
  specialtiesFull,
  onSave,
}: {
  link: Link;
  service: Service;
  manage: boolean;
  specialtiesFull: boolean;
  onSave: (fn: () => PromiseLike<{ error: unknown }>) => Promise<void>;
}) {
  const [duration, setDuration] = useState(link.duration_min_override?.toString() ?? '');
  const [ptype, setPtype] = useState<Enums<'price_type'> | ''>(link.price_type_override ?? '');
  const [pmin, setPmin] = useState(link.price_min_override?.toString() ?? '');
  const [pmax, setPmax] = useState(link.price_max_override?.toString() ?? '');
  const update = (patch: Partial<Link>) => () =>
    supabase()
      .from('staff_services')
      .update(patch)
      .eq('staff_id', link.staff_id)
      .eq('service_id', link.service_id);

  return (
    <div className="flex flex-wrap items-end gap-2 ps-6">
      <Field label="Duration override (min)">
        <input
          className={input + ' w-28'}
          type="number"
          min={5}
          step={5}
          placeholder={`${service.duration_min}`}
          value={duration}
          disabled={!manage}
          onChange={(e) => setDuration(e.target.value)}
        />
      </Field>
      <Field label="Price override">
        <select
          className={input + ' w-32'}
          value={ptype}
          disabled={!manage}
          onChange={(e) => setPtype(e.target.value as Enums<'price_type'> | '')}
        >
          <option value="">Same as service</option>
          <option value="fixed">Fixed</option>
          <option value="from">From</option>
          <option value="range">Range</option>
        </select>
      </Field>
      {ptype ? (
        <input
          className={input + ' w-20'}
          inputMode="decimal"
          aria-label="Override price"
          placeholder="$"
          value={pmin}
          disabled={!manage}
          onChange={(e) => setPmin(e.target.value)}
        />
      ) : null}
      {ptype === 'range' ? (
        <input
          className={input + ' w-20'}
          inputMode="decimal"
          aria-label="Override max price"
          placeholder="max"
          value={pmax}
          disabled={!manage}
          onChange={(e) => setPmax(e.target.value)}
        />
      ) : null}
      {manage ? (
        <button
          type="button"
          className={btn.secondary}
          onClick={() =>
            void onSave(
              update({
                duration_min_override: duration ? Number(duration) : null,
                price_type_override: ptype || null,
                price_min_override: ptype ? Number(pmin) : null,
                price_max_override: ptype === 'range' ? Number(pmax) : null,
              }),
            )
          }
        >
          Save
        </button>
      ) : null}
      <label className="flex items-center gap-2 pb-2">
        <input
          type="checkbox"
          checked={link.is_specialty}
          disabled={!manage || (!link.is_specialty && specialtiesFull)}
          onChange={(e) => void onSave(update({ is_specialty: e.target.checked }))}
        />
        Specialty {specialtiesFull && !link.is_specialty ? '(max 3)' : ''}
      </label>
    </div>
  );
}

// ─── Schedule: weekly hours, date overrides, time off, 2-week preview ──────
type Override = Tables<'staff_schedule_overrides'>;
type TimeOff = Tables<'staff_time_off'>;

async function futureBookings(staffId: string): Promise<StaffBooking[]> {
  const { data } = await supabase()
    .from('booking_items')
    .select('starts_at, ends_at, bookings!inner(id, ref, status)')
    .eq('staff_id', staffId)
    .gt('ends_at', new Date().toISOString())
    .in('bookings.status', ['pending', 'confirmed'])
    .order('starts_at');
  return (data ?? []).map((r) => {
    const b = (r as unknown as { bookings: { id: string; ref: string; status: string } }).bookings;
    return {
      booking_id: b.id,
      ref: b.ref,
      status: b.status,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
    };
  });
}

function ScheduleTab({
  staff,
  manage,
  onError,
}: {
  staff: Staff;
  manage: boolean;
  onError: (e: string | null) => void;
}) {
  const { business, location } = useBiz();
  const today = beirutToday();
  const { data, reload } = useLoad(async () => {
    if (!location) return null;
    const [w, o, t, b] = await Promise.all([
      loadStaffWeek(staff.id, location.id),
      supabase()
        .from('staff_schedule_overrides')
        .select('*')
        .eq('staff_id', staff.id)
        .gte('on_date', today)
        .order('on_date'),
      supabase().from('staff_time_off').select('*').eq('staff_id', staff.id).order('period'),
      futureBookings(staff.id),
    ]);
    return {
      week: w,
      overrides: o.data ?? [],
      timeOff: (t.data ?? []).filter((x) => Date.parse(upperOf(x.period)) > Date.now()),
      bookings: b,
    };
  }, [location?.id, staff.id, today]);
  const overrides: Override[] = data?.overrides ?? [];
  const timeOff: TimeOff[] = data?.timeOff ?? [];
  const bookings: StaffBooking[] = data?.bookings ?? [];
  const [conflicts, setConflicts] = useState<{
    list: StaffBooking[];
    proceed: () => Promise<void>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [handling, setHandling] = useState<BookingCard[] | null>(null);

  const cancelAll = async (list: StaffBooking[]) => {
    for (const b of list) {
      const { error } = await supabase().rpc('biz_cancel_booking', {
        p_booking_id: b.booking_id,
        p_reason: 'Staff schedule change',
        p_notify: true,
      });
      if (error) throw error;
    }
  };

  const guarded = async (list: StaffBooking[], proceed: () => Promise<void>) => {
    if (list.length) setConflicts({ list, proceed });
    else await proceed();
  };

  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    onError(null);
    setSaved(null);
    try {
      await fn();
      await reload();
      setSaved(msg);
    } catch (e) {
      onError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  if (!location || !data) return <p className="text-sm text-ink-500">Loading…</p>;
  const overrideDates = new Set(overrides.map((o) => o.on_date));

  const saveWeek = (week: WeekHours) =>
    guarded(outsideWeek(bookings, week, overrideDates), () =>
      act(() => saveStaffWeek(business.id, location.id, staff.id, week), 'Weekly hours saved'),
    );

  return (
    <>
      {conflicts ? (
        <Section title={`${staff.display_name} has ${conflicts.list.length} booking(s) affected`}>
          <ul className="text-sm">
            {conflicts.list.map((b) => (
              <li key={b.booking_id}>
                {fmtBeirut(b.starts_at)} · {b.ref}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn.primary}
              disabled={busy}
              onClick={() => {
                const c = conflicts;
                setConflicts(null);
                void c.proceed().then(async () => {
                  const ids = new Set(c.list.map((b) => b.booking_id));
                  const all = await affectedBookings(staff.id).catch(() => []);
                  const list = all.filter((b) => ids.has(b.booking_id));
                  if (list.length) setHandling(list);
                });
              }}
            >
              Save, then reassign or cancel each
            </button>
            <button
              type="button"
              className={btn.secondary}
              disabled={busy}
              onClick={() => {
                const c = conflicts;
                setConflicts(null);
                void c.proceed();
              }}
            >
              Save and keep these bookings
            </button>
            <button
              type="button"
              className={btn.danger}
              disabled={busy}
              onClick={() => {
                const c = conflicts;
                setConflicts(null);
                void act(async () => {
                  await cancelAll(c.list);
                  await c.proceed();
                }, 'Saved; affected bookings cancelled and customers notified');
              }}
            >
              Save and cancel them (customers notified)
            </button>
            <button type="button" className={btn.link} onClick={() => setConflicts(null)}>
              Back
            </button>
          </div>
        </Section>
      ) : null}
      {handling ? (
        <AffectedBookings
          title={`${handling.length} booking(s) outside ${staff.display_name}'s new schedule`}
          bookings={handling}
          reason="Staff schedule change"
          onDone={(msg) => {
            setHandling(null);
            setSaved(msg);
            void reload();
          }}
        />
      ) : null}
      {saved ? <Notice tone="success">{saved}</Notice> : null}

      <WeekSection
        key={JSON.stringify(data.week)}
        initial={data.week}
        manage={manage}
        busy={busy}
        onSave={saveWeek}
      />

      <OverridesSection
        overrides={overrides}
        manage={manage}
        busy={busy}
        onAdd={(o) =>
          act(async () => {
            const { error } = await supabase()
              .from('staff_schedule_overrides')
              .insert({
                ...o,
                staff_id: staff.id,
                location_id: location.id,
                business_id: business.id,
              });
            if (error) throw error;
          }, 'Date override saved')
        }
        onDelete={(id) =>
          act(async () => {
            const { error } = await supabase()
              .from('staff_schedule_overrides')
              .delete()
              .eq('id', id);
            if (error) throw error;
          }, 'Date override removed')
        }
      />

      <TimeOffSection
        timeOff={timeOff}
        manage={manage}
        busy={busy}
        onAdd={async (t) => {
          const { data: s } = await supabase().auth.getSession();
          const insert = async () =>
            act(async () => {
              const { error } = await supabase()
                .from('staff_time_off')
                .insert({
                  staff_id: staff.id,
                  business_id: business.id,
                  period: `[${t.from},${t.to})`,
                  kind: t.kind,
                  reason: t.reason || null,
                  created_by: s.session!.user.id,
                });
              if (error) throw error;
            }, 'Time off added');
          await guarded(overlapping(bookings, t.from, t.to), insert);
        }}
        onDelete={(id) =>
          act(async () => {
            const { error } = await supabase().from('staff_time_off').delete().eq('id', id);
            if (error) throw error;
          }, 'Time off removed')
        }
      />

      <Preview week={data.week} overrides={overrides} timeOff={timeOff} bookings={bookings} />
    </>
  );
}

function WeekSection({
  initial,
  manage,
  busy,
  onSave,
}: {
  initial: WeekHours;
  manage: boolean;
  busy: boolean;
  onSave: (w: WeekHours) => Promise<void>;
}) {
  const [week, setWeek] = useState<WeekHours>(initial);
  return (
    <Section
      title="Weekly hours"
      description="The gap between shifts is a break. No shifts = day off."
    >
      <HoursGrid value={week} onChange={setWeek} closedLabel="Day off" disabled={!manage} />
      {manage ? (
        <button
          type="button"
          className={btn.primary + ' self-start'}
          disabled={busy || Object.keys(weekErrors(week)).length > 0}
          onClick={() => void onSave(week)}
        >
          Save weekly hours
        </button>
      ) : null}
    </Section>
  );
}

function upperOf(range: unknown): string {
  const m = /,\s*"?([^")\]]+)"?[)\]]$/.exec(String(range));
  return m?.[1] ?? '';
}
function lowerOf(range: unknown): string {
  const m = /^[[(]"?([^",]+)"?,/.exec(String(range));
  return m?.[1] ?? '';
}

function OverridesSection({
  overrides,
  manage,
  busy,
  onAdd,
  onDelete,
}: {
  overrides: Override[];
  manage: boolean;
  busy: boolean;
  onAdd: (o: {
    on_date: string;
    is_working: boolean;
    start_minute: number | null;
    end_minute: number | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [working, setWorking] = useState(false);
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('16:00');
  return (
    <Section
      title="Date overrides"
      description={
        '"Sunday 12 Oct: working 10:00–4:00" or "Tuesday 14 Oct: off". Replaces the weekly hours for that date.'
      }
    >
      <ul className="text-sm">
        {overrides.map((o) => (
          <li key={o.id} className="flex items-center justify-between py-1">
            <span>
              {o.on_date}:{' '}
              {o.is_working && o.start_minute !== null && o.end_minute !== null
                ? `working ${label12(o.start_minute)}–${label12(o.end_minute)}`
                : 'off'}
            </span>
            {manage ? (
              <button
                type="button"
                className={btn.link}
                disabled={busy}
                onClick={() => void onDelete(o.id)}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
        {overrides.length === 0 ? <li className="text-ink-500">None coming up.</li> : null}
      </ul>
      {manage ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date">
            <input
              className={input}
              type="date"
              min={beirutToday()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className={input}
              value={working ? 'working' : 'off'}
              onChange={(e) => setWorking(e.target.value === 'working')}
            >
              <option value="off">Off</option>
              <option value="working">Working</option>
            </select>
          </Field>
          {working ? (
            <>
              <input
                className={input + ' w-28'}
                type="time"
                aria-label="Override start"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <input
                className={input + ' w-28'}
                type="time"
                aria-label="Override end"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </>
          ) : null}
          <button
            type="button"
            className={btn.secondary}
            disabled={busy || !date}
            onClick={() =>
              void onAdd({
                on_date: date,
                is_working: working,
                start_minute: working ? fromHHMM(start) : null,
                end_minute: working ? fromHHMM(end) : null,
              })
            }
          >
            Add override
          </button>
        </div>
      ) : null}
    </Section>
  );
}

const KINDS: Enums<'time_off_kind'>[] = ['vacation', 'sick', 'personal', 'training', 'other'];

function TimeOffSection({
  timeOff,
  manage,
  busy,
  onAdd,
  onDelete,
}: {
  timeOff: TimeOff[];
  manage: boolean;
  busy: boolean;
  onAdd: (t: {
    from: string;
    to: string;
    kind: Enums<'time_off_kind'>;
    reason: string;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [fromDate, setFromDate] = useState('');
  const [fromTime, setFromTime] = useState('00:00');
  const [toDate, setToDate] = useState('');
  const [toTime, setToTime] = useState('23:59');
  const [kind, setKind] = useState<Enums<'time_off_kind'>>('vacation');
  const [reason, setReason] = useState('');
  const valid = fromDate && toDate;
  return (
    <Section
      title="Time off"
      description="Vacation, sick days, training. The reason is private to owners and managers."
    >
      <ul className="text-sm">
        {timeOff.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-1">
            <span>
              {fmtBeirut(lowerOf(t.period))} → {fmtBeirut(upperOf(t.period))} · {t.kind}
              {t.reason ? ` · ${t.reason}` : ''}
            </span>
            {manage ? (
              <button
                type="button"
                className={btn.link}
                disabled={busy}
                onClick={() => void onDelete(t.id)}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
        {timeOff.length === 0 ? <li className="text-ink-500">None coming up.</li> : null}
      </ul>
      {manage ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="From">
            <div className="flex gap-1">
              <input
                className={input}
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label="Time off from date"
              />
              <input
                className={input + ' w-28'}
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                aria-label="Time off from time"
              />
            </div>
          </Field>
          <Field label="To">
            <div className="flex gap-1">
              <input
                className={input}
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                aria-label="Time off to date"
              />
              <input
                className={input + ' w-28'}
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                aria-label="Time off to time"
              />
            </div>
          </Field>
          <Field label="Kind">
            <select
              className={input}
              value={kind}
              onChange={(e) => setKind(e.target.value as Enums<'time_off_kind'>)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason (private)">
            <input
              className={input}
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy || !valid}
            onClick={() => {
              const from = beirutToUtc(fromDate, fromHHMM(fromTime) ?? 0);
              const toMin = toTime === '23:59' ? 1440 : (fromHHMM(toTime) ?? 1440);
              const to = beirutToUtc(toDate, toMin);
              void onAdd({ from, to, kind, reason });
            }}
          >
            Add time off
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function Preview({
  week,
  overrides,
  timeOff,
  bookings,
}: {
  week: WeekHours;
  overrides: Override[];
  timeOff: TimeOff[];
  bookings: StaffBooking[];
}) {
  const days = useMemo(() => beirutDays(beirutToday(), 14), []);
  return (
    <Section
      title="Next 2 weeks"
      description="What customers and the calendar will see, before and after you save."
    >
      <ul className="grid gap-1 text-sm sm:grid-cols-2" data-testid="schedule-preview">
        {days.map((d) => {
          const o = overrides.find((x) => x.on_date === d.date);
          const intervals = o
            ? o.is_working && o.start_minute !== null && o.end_minute !== null
              ? [{ start: o.start_minute, end: o.end_minute }]
              : []
            : (week[d.isoWeekday] ?? []);
          const dayStart = Date.parse(beirutToUtc(d.date, 0));
          const dayEnd = Date.parse(beirutToUtc(d.date, 1440));
          const off = timeOff.some(
            (t) =>
              Date.parse(lowerOf(t.period)) < dayEnd && Date.parse(upperOf(t.period)) > dayStart,
          );
          const count = bookings.filter((b) => {
            const s = Date.parse(b.starts_at);
            return s >= dayStart && s < dayEnd;
          }).length;
          return (
            <li
              key={d.date}
              className="flex justify-between rounded-control bg-surface-50 px-3 py-2"
            >
              <span className="font-medium">
                {new Intl.DateTimeFormat('en', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'UTC',
                }).format(new Date(`${d.date}T12:00:00Z`))}
              </span>
              <span className="text-ink-700">
                {intervals.length
                  ? intervals.map((iv) => `${toHHMM(iv.start)}–${toHHMM(iv.end)}`).join(', ')
                  : 'Off'}
                {o ? ' (override)' : ''}
                {off ? ' · time off' : ''}
                {count ? ` · ${count} booking${count > 1 ? 's' : ''}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ─── Bookings: this staff member's upcoming and past appointments ─────────
function BookingsTab({ staff }: { staff: Staff }) {
  const { business, role } = useBiz();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [open, setOpen] = useState<string | null>(null);
  const { data, reload } = useLoad(
    () => listBookings({ businessId: business.id, tab, staffId: staff.id, limit: 100 }),
    [business.id, staff.id, tab],
  );
  const rows = data?.rows ?? [];
  return (
    <Section title="Bookings" description={`${staff.display_name}'s appointments (all sources).`}>
      <div className="flex gap-2">
        {(['upcoming', 'past'] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            className={`rounded-full border px-3 py-1 text-sm ${tab === t ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
            onClick={() => setTab(t)}
          >
            {t === 'upcoming' ? 'Upcoming' : 'Past'}
          </button>
        ))}
      </div>
      {!data ? <p className="text-sm text-ink-500">Loading…</p> : null}
      {data && !rows.length ? <p className="text-sm text-ink-500">No {tab} bookings.</p> : null}
      <ul className="flex flex-col divide-y divide-line-200 text-sm" data-testid="staff-bookings">
        {rows.map((b) => (
          <li key={b.item_id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 py-2 text-start hover:bg-surface-50"
              onClick={() => setOpen(b.booking_id)}
            >
              <span>
                <span className="font-medium">{fmtBeirut(b.starts_at)}</span> ·{' '}
                {b.customer?.name ?? 'Walk-in'} · {b.service_name}
              </span>
              <span className="shrink-0 text-xs text-ink-500">
                {priceText(b) ? `${priceText(b)} · ` : ''}
                {STATUS_LABEL[b.status]}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data && data.total > rows.length ? (
        <p className="text-xs text-ink-500">
          Showing {rows.length} of {data.total} — see Bookings for more.
        </p>
      ) : null}
      {open ? (
        <BookingDrawer
          bookingId={open}
          businessId={business.id}
          role={role}
          staffOptions={[]}
          onClose={() => setOpen(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </Section>
  );
}

// ─── Access: invite to log in, revoke ──────────────────────────────────────
function AccessTab({
  staff,
  manage,
  onChanged,
  onError,
}: {
  staff: Staff;
  manage: boolean;
  onChanged: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const { business } = useBiz();
  const [phone, setPhone] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'reception' | 'manager'>('staff');
  const [link, setLink] = useState<{ url: string; phone: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const invite = async () => {
    setBusy(true);
    onError(null);
    const { data, error } = await supabase().rpc('invite_member', {
      p_business_id: business.id,
      p_phone: phone,
      p_role: inviteRole,
      p_staff_id: staff.id,
    });
    setBusy(false);
    if (error) return onError(describeError(codeOf(error)));
    const r = data as { token: string; phone_e164: string };
    setLink({ url: `${window.location.origin}/invite/${r.token}`, phone: r.phone_e164 });
  };

  if (staff.user_id) {
    return (
      <Section title="Access">
        <p className="text-sm">
          {staff.display_name} signs in with their own phone and sees their calendar.
        </p>
        {manage ? (
          <button
            type="button"
            className={btn.danger + ' self-start'}
            disabled={busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                const { error } = await supabase().rpc('revoke_member', {
                  p_business_id: business.id,
                  p_user_id: staff.user_id!,
                });
                setBusy(false);
                if (error) onError(describeError(codeOf(error)));
                await onChanged();
              })()
            }
          >
            Revoke access
          </button>
        ) : null}
      </Section>
    );
  }

  return (
    <Section
      title="Invite to log in"
      description="They get a link (send it on WhatsApp) and sign in with this phone number."
    >
      {manage ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Phone">
              <input
                className={input}
                type="tel"
                inputMode="tel"
                dir="ltr"
                placeholder="70 123 456"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label="Access">
              <select
                className={input}
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              >
                <option value="staff">Staff — own calendar</option>
                <option value="reception">Reception</option>
                <option value="manager">Manager</option>
              </select>
            </Field>
            <button
              type="button"
              className={btn.primary}
              disabled={busy || !phone.trim()}
              onClick={() => void invite()}
            >
              Create invite
            </button>
          </div>
          {link ? <InviteShare url={link.url} phone={link.phone} business={business.name} /> : null}
        </>
      ) : (
        <p className="text-sm text-ink-500">No login yet.</p>
      )}
    </Section>
  );
}
