'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ensureAnonymousSession } from '@app/api';
import { Turnstile } from '@app/ui-web';
import { Rating } from '@/components/customer/cards';
import {
  IconBack,
  IconBolt,
  IconCalendar,
  IconCalendarX,
  IconCash,
  IconClock,
  IconMoon,
  IconNote,
  IconPin,
  IconSun,
  IconSunrise,
  IconUser,
  IconUsers,
} from '@/components/customer/icons';
import { container } from '@/components/customer/layout';
import { CustomerShell } from '@/components/customer/shell';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { getPublicEnv } from '@/env';
import { beirutParts } from '@/lib/biz/schedule';
import { describeError } from '@/lib/copy';
import {
  dayText,
  durationText,
  mediaUrl,
  money,
  priceText,
  relativeDay,
  timeText,
  waLink,
  whenText,
} from '@/lib/public/format';
import type { BusinessPage, Hold, PublicService, StaffOptions } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';
import { Avatar } from './islands';

// C7–C10 booking flow (UX pass, locked references): Service → Professional → Date & time → Review.
// Behaviour is unchanged: "Any available" is the default, a concrete eligible staff member is
// assigned by the engine when the hold is taken, holds last 5 minutes, request-mode businesses get a
// request. Availability confidence is shown with colour + icon + text: Instant (⚡), Request (◷), or
// "Ask about availability" when a service can't be booked online.

type Step = 'service' | 'staff' | 'time' | 'review';
type Choice = { mode: 'any' } | { mode: 'specific'; staffId: string; rebook?: boolean };

const beirutDate = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Beirut' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const codeOf = (e: unknown) => {
  const err = (e ?? {}) as { message?: string; code?: string };
  return err.message && /^[A-Z_]+$/.test(err.message) ? err.message : 'UNKNOWN';
};

const primary =
  'flex h-12 w-full items-center justify-center gap-2 rounded-control bg-accent-600 px-4 text-base font-semibold text-white hover:bg-accent-700 disabled:opacity-50';
const card = 'rounded-card border border-line-200 bg-surface-0';
const choiceCard = (on: boolean) =>
  `flex w-full items-center gap-3 rounded-card border p-4 text-start transition-colors ${on ? 'border-accent-600 bg-accent-50 ring-1 ring-accent-600' : 'border-line-200 bg-surface-0 hover:border-accent-600'}`;

function attribution(): Record<string, string> {
  try {
    return JSON.parse(window.sessionStorage.getItem('app:attribution') ?? '{}') as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function Radio({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-6 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-accent-600' : 'border-line-200'}`}
    >
      {on ? <span className="size-3 rounded-full bg-accent-600" /> : null}
    </span>
  );
}

/** Instant / Request badge — colour, icon and text, never colour alone. */
export function ConfidenceTag({ instant }: { instant: boolean }) {
  return instant ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-600">
      <IconBolt size={13} /> Instant
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-700">
      <IconClock size={13} /> Request
    </span>
  );
}

export function BookingFlow({ page: cached }: { page: BusinessPage }) {
  // The server-rendered payload may be up to a minute old; booking rules (request mode, policy)
  // must be current, so refresh them once on arrival.
  const [fresh, setFresh] = useState<BusinessPage | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase()
      .rpc('get_business_page', { p_slug: cached.business.slug })
      .then(({ data }) => {
        const r = data as unknown as BusinessPage | null;
        if (alive && r?.state === 'ok') setFresh(r);
      });
    return () => {
      alive = false;
    };
  }, [cached.business.slug]);
  const page = fresh ?? cached;
  const router = useRouter();
  const params = useSearchParams();
  const { business: b, location: l, rules } = page;
  const online = page.services.filter((s) => s.online);
  const instant = rules.booking_mode !== 'request';

  const [step, setStep] = useState<Step>(params.get('service') ? 'staff' : 'service');
  const [serviceId, setServiceId] = useState<string | null>(params.get('service'));
  const [choice, setChoice] = useState<Choice>({ mode: 'any' });
  const [options, setOptions] = useState<StaffOptions | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [days, setDays] = useState<Set<string> | null>(null);
  // slots are keyed by what they were loaded for, so a change shows the skeleton immediately
  const [slotData, setSlotData] = useState<{
    key: string;
    list: string[];
    next: string | null;
  } | null>(null);
  const [slotNonce, setSlotNonce] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(params.get('start'));

  const service: PublicService | undefined = online.find((s) => s.id === serviceId);
  const staffId = choice.mode === 'specific' ? choice.staffId : null;
  const staffName = (id: string | null) =>
    (options?.staff.find((s) => s.id === id) ?? page.staff.find((s) => s.id === id))?.name.split(
      ' ',
    )[0] ?? '';

  useEffect(() => {
    void supabase()
      .auth.getSession()
      .then(({ data }) => setHasSession(!!data.session));
  }, []);

  const flash = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 4000);
  };

  // staff options for the chosen service, and the auto-skip rules (C8 §13)
  useEffect(() => {
    if (!serviceId) return;
    let alive = true;
    void supabase()
      .rpc('get_staff_options', { p_location_id: l.id, p_service_id: serviceId })
      .then(({ data }) => {
        if (!alive) return;
        const o = (data as unknown as StaffOptions | null) ?? {
          choice_mode: rules.staff_choice_mode,
          any_next: null,
          rebook: null,
          staff: [],
        };
        setOptions(o);
        const wanted = params.get('staff');
        if (wanted && o.staff.some((s) => s.id === wanted)) {
          setChoice({ mode: 'specific', staffId: wanted });
          setStep('time');
        } else if (o.choice_mode === 'any_only') {
          setChoice({ mode: 'any' });
          setStep('time');
        } else if (o.staff.length === 1) {
          setChoice({ mode: 'specific', staffId: o.staff[0]!.id });
          setStep('time');
        } else if (o.choice_mode === 'choose_only' && o.staff[0]) {
          setChoice({ mode: 'specific', staffId: o.staff[0].id });
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the service changes
  }, [serviceId]);

  // days with availability (14 days) for the chosen service + staff
  useEffect(() => {
    if (step !== 'time' || !serviceId) return;
    let alive = true;
    void supabase()
      .rpc('get_available_days', {
        p_location_id: l.id,
        p_service_id: serviceId,
        p_staff_id: staffId ?? undefined,
        p_date_from: beirutDate(0),
        p_date_to: beirutDate(13),
      })
      .then(({ data }) => {
        if (!alive) return;
        const set = new Set((data ?? []) as string[]);
        setDays(set);
        const first = pendingStart ? beirutParts(pendingStart).date : [...set].sort()[0];
        setDate((d) => (d && set.has(d) ? d : (first ?? beirutDate(0))));
      });
    return () => {
      alive = false;
    };
  }, [step, serviceId, staffId, l.id, pendingStart]);

  const slotKey = `${serviceId}|${staffId ?? 'any'}|${date}|${slotNonce}`;
  const slots = slotData?.key === slotKey ? slotData.list : null;
  const nextAfter = slotData?.key === slotKey ? slotData.next : null;
  const reloadSlots = () => setSlotNonce((n) => n + 1);

  useEffect(() => {
    if (step !== 'time' || !date || !serviceId) return;
    let alive = true;
    const key = slotKey;
    void (async () => {
      const { data } = await supabase().rpc('get_available_slots', {
        p_location_id: l.id,
        p_service_id: serviceId,
        p_staff_id: staffId ?? undefined,
        p_date_from: date,
        p_date_to: date,
      });
      const list = (data ?? []).map((r) => r.slot_start);
      let next: string | null = null;
      if (!list.length) {
        const { data: n } = await supabase().rpc('get_next_available', {
          p_location_id: l.id,
          p_service_id: serviceId,
          p_staff_id: staffId ?? undefined,
        });
        next = (n as string | null) ?? null;
      }
      if (alive) setSlotData({ key, list, next });
    })();
    return () => {
      alive = false;
    };
  }, [step, date, serviceId, staffId, l.id, slotKey]);

  const takeSlot = useCallback(
    async (start: string) => {
      if (!serviceId) return;
      setBusy(true);
      try {
        const { data: s } = await supabase().auth.getSession();
        if (!s.session) {
          if (!captcha) throw { message: 'CAPTCHA_FAILED' };
          await ensureAnonymousSession(supabase(), captcha);
          setHasSession(true);
        }
        const { data, error } = await supabase().rpc('create_hold', {
          p_location_id: l.id,
          p_service_id: serviceId,
          p_start: start,
          p_staff_id: staffId ?? undefined,
          p_selection_mode:
            choice.mode === 'specific' ? (choice.rebook ? 'rebook' : 'specific') : 'any',
          p_source: 'business_link',
          p_attribution: attribution(),
        });
        if (error || !data?.[0]) throw error ?? { message: 'SLOT_TAKEN' };
        setHold(data[0] as Hold);
        setPendingStart(null);
        setPicked(null);
        setStep('review');
      } catch (e) {
        const code = codeOf(e);
        if (code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FREE' || code === 'INVALID_SLOT') {
          flash(`Someone just booked ${timeText(start)}. Pick another time.`);
          setPendingStart(null);
          setPicked(null);
          reloadSlots();
        } else flash(describeError(code, { staff: staffName(staffId) || 'This person' }));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- staffName reads current options
    [serviceId, staffId, choice, captcha, l.id],
  );

  // a time chosen on the business page: hold it as soon as we know who (and have a session)
  useEffect(() => {
    if (
      step === 'time' &&
      pendingStart &&
      hasSession !== null &&
      (hasSession || captcha) &&
      !busy &&
      !hold
    ) {
      const t = window.setTimeout(() => void takeSlot(pendingStart), 0);
      return () => window.clearTimeout(t);
    }
  }, [step, pendingStart, hasSession, captcha, busy, hold, takeSlot]);

  const back = () => {
    if (step === 'service') router.push(`/${b.slug}`);
    else if (step === 'staff') setStep('service');
    else if (step === 'time')
      setStep(
        options && options.staff.length > 1 && options.choice_mode !== 'any_only'
          ? 'staff'
          : 'service',
      );
    else setStep('time');
  };
  const titles: Record<Step, string> = {
    service: 'Choose a service',
    staff: service?.name ?? 'Professional',
    time: 'Date & time',
    review: 'Review your booking',
  };
  const stepNo = { service: 1, staff: 2, time: 3, review: 4 }[step];

  const summary = (
    <aside className="hidden lg:block" aria-label="Booking summary">
      <div className={`${card} sticky top-24 flex flex-col gap-3 p-5`} data-testid="side-summary">
        <p className="text-lg font-semibold" dir="auto">
          {b.name}
        </p>
        <p className="text-sm">
          <Rating value={page.rating.display_rating} count={page.rating.review_count} />
        </p>
        {l.area?.en ? (
          <p className="flex items-center gap-1.5 text-sm text-ink-700">
            <IconPin size={16} /> {l.area.en}
          </p>
        ) : null}
        <hr className="border-line-200" />
        <SummaryLine
          label="Service"
          value={service ? `${service.name} · ${durationText(service.duration_min)}` : '—'}
        />
        <SummaryLine
          label="Professional"
          value={
            hold
              ? hold.staff_first_name
              : choice.mode === 'any'
                ? 'Any available'
                : staffName(staffId) || '—'
          }
        />
        <SummaryLine
          label="Time"
          value={hold ? whenText(hold.starts_at) : picked ? whenText(picked) : '—'}
        />
        <SummaryLine label="Price" value={service ? priceText(service) : '—'} />
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          {instant ? (
            <>
              <IconBolt size={14} className="text-accent-600" /> Instant confirmation
            </>
          ) : (
            <>
              <IconClock size={14} /> {b.name} confirms each request
            </>
          )}
        </p>
      </div>
    </aside>
  );

  return (
    <CustomerShell mobileHeader={false} mobileNav={false}>
      <div className={`${container} pb-32 lg:pb-12`}>
        {/* step header: back · title (phones) — back · business · step (desktop) */}
        <div className="sticky top-0 z-20 -mx-4 flex h-14 items-center gap-2 bg-surface-50/95 px-2 backdrop-blur sm:-mx-6 sm:px-4 lg:static lg:mx-0 lg:mt-6 lg:h-auto lg:px-0 lg:backdrop-blur-none">
          <button
            type="button"
            onClick={back}
            className="grid size-11 place-items-center rounded-full text-accent-600 hover:bg-surface-100"
            aria-label="Back"
          >
            <IconBack size={22} className="rtl:rotate-180" />
          </button>
          <h1
            className="flex-1 truncate text-center text-lg font-semibold lg:text-start lg:text-2xl"
            data-testid="flow-title"
          >
            {titles[step]}
          </h1>
          <span className="w-11 text-end text-xs text-ink-500 lg:w-auto" data-testid="stepper">
            {stepNo}/4
          </span>
        </div>
        <p className="mb-4 hidden text-sm text-ink-500 lg:block">
          <Link href={`/${b.slug}`} className="font-medium text-ink-900 hover:underline">
            {b.name}
          </Link>
          {l.area?.en ? ` · ${l.area.en}` : ''}
        </p>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <main className="flex min-w-0 flex-col gap-5 pt-2 lg:pt-0">
            {step === 'service' ? (
              <section className="flex flex-col gap-3" data-testid="step-service">
                {!online.length ? (
                  <p className="text-sm">
                    This business takes bookings by WhatsApp.{' '}
                    {l.whatsapp ? (
                      <a className="font-medium text-accent-600" href={waLink(l.whatsapp) ?? '#'}>
                        Ask about availability
                      </a>
                    ) : null}
                  </p>
                ) : null}
                <ul className="grid gap-3 sm:grid-cols-2">
                  {online.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={`${choiceCard(false)} h-full flex-col items-start`}
                        onClick={() => {
                          setServiceId(s.id);
                          setOptions(null);
                          setChoice({ mode: 'any' });
                          setHold(null);
                          setPicked(null);
                          setStep('staff');
                        }}
                      >
                        <span className="flex w-full items-start justify-between gap-2">
                          <span className="font-semibold" dir="auto">
                            {s.name}
                          </span>
                          <span className="shrink-0 font-semibold">{priceText(s)}</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-sm text-ink-500">
                          <IconClock size={15} /> {durationText(s.duration_min)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {step === 'staff' && service ? (
              <section className="flex flex-col gap-4" data-testid="step-staff">
                <ServiceHeader service={service} />
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Choose your professional</h2>
                  <p className="text-sm text-ink-500">
                    Pick who you’d like to book with for this service.
                  </p>
                </div>
                {!options ? (
                  <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                    {[0, 1, 2, 3].map((i) => (
                      <span key={i} className="h-24 animate-pulse rounded-card bg-surface-100" />
                    ))}
                  </div>
                ) : null}
                {options?.rebook ? (
                  <button
                    type="button"
                    className={choiceCard(false)}
                    onClick={() => {
                      setChoice({
                        mode: 'specific',
                        staffId: options.rebook!.staff_id,
                        rebook: true,
                      });
                      setStep('time');
                    }}
                    data-testid="rebook-shortcut"
                  >
                    <Avatar
                      name={options.rebook.name}
                      url={mediaUrl(
                        options.staff.find((s) => s.id === options.rebook!.staff_id)?.photo_path,
                      )}
                      size="size-14"
                    />
                    <span className="flex flex-col">
                      <span className="font-semibold">Book again with {options.rebook.name}</span>
                      <span className="text-sm text-ink-500">
                        Your last visit · {dayText(options.rebook.last_visit_at)}
                      </span>
                    </span>
                  </button>
                ) : null}
                {options ? (
                  <div
                    className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                    role="radiogroup"
                    aria-label="Professional"
                    data-testid="staff-list"
                  >
                    {options.choice_mode !== 'choose_only' ? (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={choice.mode === 'any'}
                        className={`${choiceCard(choice.mode === 'any')} sm:col-span-2 xl:col-span-3`}
                        onClick={() => setChoice({ mode: 'any' })}
                      >
                        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-100 text-accent-600">
                          <IconUsers size={26} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="font-semibold">Any available</span>
                          <span className="text-sm text-ink-700">
                            We’ll assign the first available professional for you.
                          </span>
                          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-0 px-2.5 py-1 text-sm">
                            <IconClock size={15} />
                            {options.any_next
                              ? `Earliest ${whenText(options.any_next)}`
                              : 'No times in the next weeks'}
                          </span>
                        </span>
                        <Radio on={choice.mode === 'any'} />
                      </button>
                    ) : null}
                    {options.staff
                      .slice()
                      .sort((a, c) => (a.next_available ? 0 : 1) - (c.next_available ? 0 : 1))
                      .map((s) => {
                        const on = choice.mode === 'specific' && choice.staffId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            className={`${choiceCard(on)} ${s.next_available ? '' : 'opacity-60'}`}
                            onClick={() => setChoice({ mode: 'specific', staffId: s.id })}
                          >
                            <Avatar name={s.name} url={mediaUrl(s.photo_path)} size="size-14" />
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="font-semibold">{s.name.split(' ')[0]}</span>
                              {s.role_title || s.specialties.length ? (
                                <span className="line-clamp-1 text-sm text-ink-700">
                                  {s.role_title ?? s.specialties.join(' · ')}
                                </span>
                              ) : null}
                              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-100 px-2.5 py-1 text-sm">
                                <IconClock size={15} />
                                {s.next_available
                                  ? whenText(s.next_available)
                                  : 'Fully booked for 14 days'}
                              </span>
                              {s.differs ? (
                                <span className="text-xs text-ink-500">
                                  {priceText(s)} · {durationText(s.duration_min)}
                                </span>
                              ) : null}
                            </span>
                            <Radio on={on} />
                          </button>
                        );
                      })}
                  </div>
                ) : null}
                <StickyAction>
                  <button
                    type="button"
                    className={primary}
                    disabled={!options}
                    onClick={() => setStep('time')}
                    data-testid="staff-continue"
                  >
                    Continue
                  </button>
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-ink-500">
                    <IconCash size={14} /> Pay at the business — nothing is charged now
                  </p>
                </StickyAction>
              </section>
            ) : null}

            {step === 'time' && service ? (
              <section className="flex flex-col gap-5" data-testid="step-time">
                <div className={`${card} flex items-center gap-3 p-3`}>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-semibold" dir="auto">
                      {service.name}
                    </span>
                    <span className="text-sm text-ink-700">
                      {priceText(service)} · {durationText(service.duration_min)}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm text-ink-700">
                      <IconUser size={15} />{' '}
                      {choice.mode === 'any' ? 'Any available' : `with ${staffName(staffId)}`}
                    </span>
                  </span>
                  {options && options.staff.length > 1 && options.choice_mode !== 'any_only' ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-accent-600"
                      onClick={() => setStep('staff')}
                    >
                      Change
                    </button>
                  ) : null}
                </div>

                <div
                  className="rail -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
                  data-testid="date-strip"
                  role="group"
                  aria-label="Date"
                >
                  {Array.from({ length: 14 }, (_, i) => addDays(beirutDate(0), i)).map((d, i) => {
                    const has = days?.has(d) ?? false;
                    const on = date === d;
                    const label =
                      i === 0
                        ? 'Today'
                        : i === 1
                          ? 'Tomorrow'
                          : new Intl.DateTimeFormat('en-GB', {
                              weekday: 'short',
                              timeZone: 'UTC',
                            }).format(new Date(`${d}T12:00:00Z`));
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={!has}
                        aria-pressed={on}
                        aria-label={relativeDay(d, beirutDate(0))}
                        className={`flex w-[76px] shrink-0 flex-col items-center gap-0.5 rounded-card border py-2.5 text-sm lg:w-[84px] ${on ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0 hover:border-accent-600'} disabled:cursor-not-allowed disabled:opacity-40`}
                        onClick={() => {
                          setDate(d);
                          setPicked(null);
                        }}
                      >
                        <span className="text-xs">{label}</span>
                        <span className="text-xl font-semibold leading-tight">
                          {Number(d.slice(8))}
                        </span>
                        <span className="text-xs">
                          {new Intl.DateTimeFormat('en-GB', {
                            month: 'short',
                            timeZone: 'UTC',
                          }).format(new Date(`${d}T12:00:00Z`))}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {hasSession === false ? (
                  <div className="text-xs text-ink-500">
                    <Turnstile
                      siteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                      onToken={setCaptcha}
                    />
                  </div>
                ) : null}

                {slots === null ? (
                  <div
                    className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
                    aria-busy="true"
                  >
                    {Array.from({ length: 8 }, (_, i) => (
                      <span key={i} className="h-14 animate-pulse rounded-control bg-surface-100" />
                    ))}
                  </div>
                ) : !slots.length ? (
                  <div className={`${card} p-4 text-sm`} data-testid="no-slots">
                    No times on {date ? relativeDay(date, beirutDate(0)) : 'this day'}.
                    {nextAfter ? (
                      <>
                        {' '}
                        Next available:{' '}
                        <button
                          type="button"
                          className="font-semibold text-accent-600"
                          onClick={() => setDate(beirutParts(nextAfter).date)}
                        >
                          {relativeDay(beirutParts(nextAfter).date, beirutDate(0))}{' '}
                          {timeText(nextAfter)} →
                        </button>
                      </>
                    ) : l.whatsapp ? (
                      <>
                        {' '}
                        <a
                          className="font-semibold text-accent-600"
                          href={
                            waLink(l.whatsapp, `Hi! Do you have a time for ${service.name}?`) ?? '#'
                          }
                        >
                          Ask about availability
                        </a>
                      </>
                    ) : null}
                  </div>
                ) : (
                  (
                    [
                      ['Morning', IconSunrise, (m: number) => m < 720],
                      ['Afternoon', IconSun, (m: number) => m >= 720 && m < 1080],
                      ['Evening', IconMoon, (m: number) => m >= 1080],
                    ] as const
                  ).map(([part, Icon, inRange]) => {
                    const inPart = slots.filter((s) => inRange(beirutParts(s).minutes));
                    if (!inPart.length) return null;
                    return (
                      <div
                        key={part}
                        className="flex flex-col gap-3 border-b border-line-200 pb-5 last:border-0"
                      >
                        <p className="flex items-center gap-3">
                          <span className="grid size-10 place-items-center rounded-full bg-surface-100 text-ink-700">
                            <Icon size={20} />
                          </span>
                          <span className="font-semibold">{part}</span>
                          <span className="text-sm text-ink-500">
                            {inPart.length} time{inPart.length === 1 ? '' : 's'}
                          </span>
                        </p>
                        <div
                          className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4 md:grid-cols-5 xl:grid-cols-6"
                          data-testid="slots"
                        >
                          {inPart.map((s) => {
                            const on = picked === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={on}
                                disabled={busy || (hasSession === false && !captcha)}
                                className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-control border text-sm font-semibold transition-colors disabled:opacity-50 ${on ? 'border-accent-600 bg-accent-600 text-white [&_span]:text-white' : instant ? 'border-accent-100 bg-accent-50 hover:border-accent-600' : 'border-line-200 bg-surface-0 hover:border-accent-600'}`}
                                onClick={() => setPicked(s)}
                              >
                                {timeText(s)}
                                <ConfidenceTag instant={instant} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}

                <div
                  className={`${card} flex items-center gap-3 bg-surface-100/60 p-3 text-sm`}
                  data-testid="confidence-legend"
                >
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-full ${instant ? 'bg-accent-600 text-white' : 'bg-surface-0 text-ink-700'}`}
                  >
                    {instant ? <IconBolt size={18} /> : <IconClock size={18} />}
                  </span>
                  <span className="flex flex-col">
                    <span className="font-semibold">
                      {instant ? 'Instant booking' : 'Request booking'}
                    </span>
                    <span className="text-ink-700">
                      {instant
                        ? 'Get confirmed immediately.'
                        : `${b.name} confirms your request, usually within ${Math.max(1, Math.round(rules.request_expiry_minutes / 60))} h.`}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-ink-500">
                  Times shown in Beirut time.
                  {rules.min_notice_minutes >= 60
                    ? ` Bookings need ${Math.round(rules.min_notice_minutes / 60)}h notice.`
                    : ''}
                </p>

                <StickyAction>
                  <button
                    type="button"
                    className={primary}
                    disabled={!picked || busy || (hasSession === false && !captcha)}
                    onClick={() => picked && void takeSlot(picked)}
                    data-testid="time-continue"
                  >
                    {busy
                      ? 'Holding your time…'
                      : picked
                        ? `Continue · ${timeText(picked)}`
                        : 'Pick a time'}
                  </button>
                </StickyAction>
              </section>
            ) : null}

            {step === 'review' && service && hold ? (
              <Review
                page={page}
                service={service}
                hold={hold}
                options={options}
                choiceMode={choice.mode}
                onHold={setHold}
                onBack={(msg) => {
                  if (msg) flash(msg);
                  setHold(null);
                  setStep('time');
                  reloadSlots();
                }}
                onRetake={(start) => {
                  setHold(null);
                  setPendingStart(start);
                  setStep('time');
                }}
              />
            ) : null}
          </main>
          {summary}
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          data-testid="toast"
          className="fixed inset-x-4 bottom-28 z-50 mx-auto max-w-md rounded-control bg-ink-900 px-4 py-3 text-sm text-white"
        >
          {toast}
        </div>
      ) : null}
    </CustomerShell>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-3 text-sm">
      <span className="text-ink-500">{label}</span>
      <span className="text-end font-medium" dir="auto">
        {value}
      </span>
    </p>
  );
}

/** Compact service header (the service is already chosen — it must not take half the screen). */
function ServiceHeader({ service }: { service: PublicService }) {
  return (
    <div className={`${card} flex flex-col gap-1 p-4`}>
      <p className="text-lg font-semibold" dir="auto">
        {service.name}
      </p>
      {service.description ? (
        <p className="line-clamp-2 text-sm text-ink-700" dir="auto">
          {service.description}
        </p>
      ) : null}
      <p className="flex items-center gap-4 text-sm text-ink-700">
        <span className="flex items-center gap-1.5">
          <IconClock size={16} /> {durationText(service.duration_min)}
        </span>
        <span className="font-semibold text-ink-900">{priceText(service)}</span>
      </p>
    </div>
  );
}

/** Primary action: sticky above the home indicator on phones/tablets, inline on desktop. */
function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line-200 bg-surface-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
      <div className="mx-auto max-w-xl lg:mx-0 lg:max-w-sm">{children}</div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  title,
  children,
  testId,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`${card} flex gap-4 p-4`} data-testid={testId}>
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-600">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-ink-500">{label}</span>
        <span className="font-semibold">{title}</span>
        {children ? <span className="text-sm text-ink-700">{children}</span> : null}
      </span>
    </div>
  );
}

function Review({
  page,
  service,
  hold,
  options,
  choiceMode,
  onHold,
  onBack,
  onRetake,
}: {
  page: BusinessPage;
  service: PublicService;
  hold: Hold;
  options: StaffOptions | null;
  choiceMode: 'any' | 'specific';
  onHold: (h: Hold) => void;
  onBack: (msg?: string) => void;
  onRetake: (start: string) => void;
}) {
  const router = useRouter();
  const { business: b, location: l, rules } = page;
  const [verified, setVerified] = useState<boolean | null>(null);
  const [needName, setNeedName] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [left, setLeft] = useState(() => Date.parse(hold.expires_at) - Date.now());
  const [idem] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const t = window.setInterval(() => setLeft(Date.parse(hold.expires_at) - Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [hold.expires_at]);

  const checkIdentity = useCallback(async () => {
    const { data } = await supabase().auth.getSession();
    const user = data.session?.user;
    if (!user || user.is_anonymous) return setVerified(false);
    const { data: prof } = await supabase()
      .from('profiles')
      .select('first_name')
      .eq('id', user.id)
      .maybeSingle();
    setNeedName(!prof?.first_name);
    setVerified(true);
  }, []);
  useEffect(() => {
    let alive = true;
    void supabase()
      .auth.getSession()
      .then(() => alive && void checkIdentity());
    return () => {
      alive = false;
    };
  }, [checkIdentity]);

  const expired = left <= 0;
  const mm = Math.max(0, Math.floor(left / 60000));
  const ss = Math.max(0, Math.floor((left % 60000) / 1000));
  const request = rules.booking_mode === 'request';
  const cancelHours = Math.round(rules.cancellation_window_minutes / 60);
  const cancelTitle =
    rules.cancellation_window_minutes <= 0
      ? 'Free cancellation until the appointment starts'
      : `Free cancellation until ${cancelHours >= 1 ? `${cancelHours} hour${cancelHours === 1 ? '' : 's'}` : `${rules.cancellation_window_minutes} minutes`} before the appointment`;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase().rpc('confirm_booking', {
      p_booking_id: hold.booking_id,
      p_hold_token: hold.hold_token,
      p_first_name: first.trim() || undefined,
      p_last_name: last.trim() || undefined,
      p_customer_note: note.trim() || undefined,
      p_idempotency_key: idem,
    });
    if (err || !data) {
      setBusy(false);
      const code = codeOf(err);
      if (code === 'SLOT_TAKEN' || code === 'HOLD_EXPIRED' || code === 'HOLD_NOT_FOUND') {
        if (code === 'HOLD_EXPIRED') return onRetake(hold.starts_at);
        return onBack(describeError(code));
      }
      return setError(describeError(code));
    }
    router.push(`/bookings/${(data as { id: string }).id}?new=1`);
  };

  const others = (options?.staff ?? []).filter((s) => s.id !== hold.staff_id);

  return (
    <section className="flex flex-col gap-4" data-testid="step-review">
      <p className="text-sm text-ink-500">Please check the details below before confirming.</p>
      <p
        className={`text-sm font-medium ${expired ? 'text-danger-600' : 'text-ink-700'}`}
        data-testid="hold-timer"
        role="timer"
      >
        {expired
          ? 'Your hold expired.'
          : `We’re holding this time for ${mm}:${String(ss).padStart(2, '0')}`}
      </p>

      <div className={`${card} flex flex-col gap-3 p-4`} data-testid="summary">
        <div>
          <p className="text-lg font-semibold" dir="auto">
            {service.name}
          </p>
          <p className="text-ink-700" dir="auto">
            {b.name}
          </p>
        </div>
        <ul className="flex flex-col gap-2.5 text-[15px]">
          <li className="flex items-start gap-3" data-testid="summary-staff">
            <IconUser size={20} className="mt-0.5 shrink-0 text-ink-700" />
            <span className="flex flex-col">
              {choiceMode === 'any' ? (
                <>
                  <span>
                    You’ll be with <span className="font-semibold">{hold.staff_first_name}</span>
                  </span>
                  <span className="text-xs text-ink-500">
                    Assigned from available staff
                    {others.length ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="font-medium text-accent-600"
                          onClick={() => setChanging((c) => !c)}
                        >
                          Change
                        </button>
                      </>
                    ) : null}
                  </span>
                </>
              ) : (
                <span>
                  with <span className="font-semibold">{hold.staff_first_name}</span>
                </span>
              )}
            </span>
          </li>
          {changing ? (
            <li className="flex flex-wrap gap-2 ps-8">
              {others.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="h-10 rounded-full border border-line-200 bg-surface-0 px-4 text-sm hover:border-accent-600"
                  onClick={() =>
                    void supabase()
                      .rpc('change_hold_staff', {
                        p_booking_id: hold.booking_id,
                        p_hold_token: hold.hold_token,
                        p_staff_id: s.id,
                      })
                      .then(({ data, error: err }) => {
                        if (err || !data?.[0])
                          return setError(
                            `${s.name.split(' ')[0]} isn’t free at ${timeText(hold.starts_at)}.`,
                          );
                        onHold({
                          ...hold,
                          ...(data[0] as Partial<Hold>),
                          selection_mode: 'specific',
                        });
                        setChanging(false);
                      })
                  }
                >
                  {s.name.split(' ')[0]}
                </button>
              ))}
            </li>
          ) : null}
          {l.area?.en ? (
            <li className="flex items-center gap-3">
              <IconPin size={20} className="shrink-0 text-ink-700" /> {l.area.en}
            </li>
          ) : null}
          <li className="flex items-center gap-3" data-testid="summary-time">
            <IconCalendar size={20} className="shrink-0 text-ink-700" />
            {relativeDay(beirutParts(hold.starts_at).date, beirutDate(0))} ·{' '}
            {timeText(hold.starts_at)}–{timeText(hold.ends_at)}
          </li>
          <li className="flex items-center gap-3">
            <IconClock size={20} className="shrink-0 text-ink-700" />{' '}
            {durationText(service.duration_min)}
          </li>
          <li className="flex items-center gap-3 font-semibold">
            <IconCash size={20} className="shrink-0 font-normal text-ink-700" />
            {priceText({ ...hold, currency: service.currency })}
          </li>
        </ul>
      </div>

      {expired ? (
        <button type="button" className={primary} onClick={() => onRetake(hold.starts_at)}>
          Check if {timeText(hold.starts_at)} is still free
        </button>
      ) : null}

      <InfoCard
        icon={request ? <IconClock size={22} /> : <IconBolt size={22} />}
        label="Booking status"
        title={request ? 'Request — the business confirms' : 'Instant confirmation'}
        testId="booking-status-card"
      >
        {request
          ? `${b.name} will confirm your request, usually within ${Math.max(1, Math.round(rules.request_expiry_minutes / 60))} hours. You’ll get a message either way.`
          : 'Your appointment will be instantly confirmed once you complete the booking.'}
      </InfoCard>
      <InfoCard icon={<IconCash size={22} />} label="Payment" title="Cash at the business">
        Pay directly at {b.name} after your service. Nothing is charged now.
      </InfoCard>
      <div data-testid="policy">
        <InfoCard icon={<IconCalendarX size={22} />} label="Cancellation" title={cancelTitle}>
          Missed appointments may limit instant booking in the future. You’ll get a confirmation and
          a reminder on WhatsApp.
        </InfoCard>
      </div>

      <div className={`${card} flex flex-col gap-3 p-4`}>
        <p className="font-semibold">Your details</p>
        {verified === false ? (
          <PhoneSignIn
            beforeRequest={async () => {
              await supabase().rpc('extend_hold', {
                p_booking_id: hold.booking_id,
                p_hold_token: hold.hold_token,
              });
            }}
            onVerified={() => void checkIdentity()}
          />
        ) : null}
        {verified ? (
          <p className="text-sm text-success-600" data-testid="phone-verified">
            Phone verified ✓
          </p>
        ) : null}
        {verified && needName ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">First name</span>
              <input
                className="h-11 rounded-control border border-line-200 bg-surface-0 px-3"
                value={first}
                maxLength={50}
                onChange={(e) => setFirst(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Last name (optional)</span>
              <input
                className="h-11 rounded-control border border-line-200 bg-surface-0 px-3"
                value={last}
                maxLength={50}
                onChange={(e) => setLast(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-2 font-medium">
            <IconNote size={16} /> Note to {b.name} (optional)
          </span>
          <textarea
            className="h-20 rounded-control border border-line-200 bg-surface-0 p-3"
            maxLength={200}
            placeholder="e.g. Preferred style, special requests…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <p className="text-xs text-ink-500">
        By booking you agree to the{' '}
        <Link className="underline" href="/terms">
          terms
        </Link>{' '}
        and{' '}
        <Link className="underline" href="/privacy">
          privacy policy
        </Link>
        .
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger-600" data-testid="review-error">
          {error}
        </p>
      ) : null}

      <StickyAction>
        <button
          type="button"
          className={primary}
          disabled={busy || !verified || expired || (needName && !first.trim())}
          onClick={() => void confirm()}
          data-testid="confirm-booking"
        >
          {busy ? 'Booking…' : request ? 'Send booking request' : 'Confirm booking'}
          {!busy && hold.price_min !== null && hold.price_type !== 'on_consultation'
            ? ` · ${money(hold.price_min, service.currency)}`
            : ''}
        </button>
      </StickyAction>
    </section>
  );
}
