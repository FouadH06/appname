'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ensureAnonymousSession } from '@app/api';
import { Turnstile } from '@app/ui-web';
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
} from '@/lib/public/format';
import type { BusinessPage, Hold, PublicService, StaffOptions } from '@/lib/public/types';
import { supabase } from '@/lib/supabase';
import { Avatar } from './islands';

// C7–C10 booking flow: Service → Staff preference → Date & time → Review (+ phone code).
// Any available is the default; a concrete staff member is assigned when the time is tapped.

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
  'flex h-12 w-full items-center justify-center rounded-control bg-accent-600 px-4 text-base font-semibold text-white disabled:opacity-50';
const chip = (on: boolean) =>
  `whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${on ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0'}`;

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
        setStep('review');
      } catch (e) {
        const code = codeOf(e);
        if (code === 'SLOT_TAKEN' || code === 'STAFF_NOT_FREE' || code === 'INVALID_SLOT') {
          flash(`Someone just booked ${timeText(start)}. Pick another time.`);
          setPendingStart(null);
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

  const header = (n: number, label: string) => (
    <div className="flex items-center justify-between">
      <button
        type="button"
        className="text-sm font-medium text-accent-600"
        onClick={() => {
          if (step === 'service') router.push(`/${b.slug}`);
          else if (step === 'staff') setStep('service');
          else if (step === 'time')
            setStep(
              options && options.staff.length > 1 && options.choice_mode !== 'any_only'
                ? 'staff'
                : 'service',
            );
          else setStep('time');
        }}
      >
        ← Back
      </button>
      <span className="text-xs text-ink-500" data-testid="stepper">
        {n} of 4 · {label}
      </span>
    </div>
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 pb-28 pt-4">
      <p className="text-sm text-ink-500">
        <Link href={`/${b.slug}`} className="font-medium text-ink-900">
          {b.name}
        </Link>
        {l.area?.en ? ` · ${l.area.en}` : ''}
      </p>

      {step === 'service' ? (
        <section className="flex flex-col gap-3" data-testid="step-service">
          {header(1, 'Service')}
          <h1 className="text-xl font-semibold">What would you like to book?</h1>
          {!online.length ? (
            <p className="text-sm">
              This business takes bookings by WhatsApp.{' '}
              {l.whatsapp ? (
                <a className="font-medium text-accent-600" href={waLink(l.whatsapp) ?? '#'}>
                  WhatsApp
                </a>
              ) : null}
            </p>
          ) : null}
          <ul className="flex flex-col divide-y divide-line-200 rounded-card border border-line-200 bg-surface-0">
            {online.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
                  onClick={() => {
                    setServiceId(s.id);
                    setOptions(null);
                    setChoice({ mode: 'any' });
                    setHold(null);
                    setStep('staff');
                  }}
                >
                  <span className="min-w-0">
                    <span className="block font-medium" dir="auto">
                      {s.name}
                    </span>
                    <span className="text-sm text-ink-500">
                      {durationText(s.duration_min)} · {priceText(s)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-accent-600">Select</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {step === 'staff' && service ? (
        <section className="flex flex-col gap-3" data-testid="step-staff">
          {header(2, 'Who')}
          <p className="text-sm text-ink-700">
            {service.name} · {priceText(service)}
          </p>
          <h1 className="text-xl font-semibold">Who would you like?</h1>
          {!options ? <p className="text-sm text-ink-500">Loading…</p> : null}
          {options?.rebook ? (
            <button
              type="button"
              className="flex items-center gap-3 rounded-card border border-accent-600 bg-surface-0 p-4 text-start"
              onClick={() => {
                setChoice({ mode: 'specific', staffId: options.rebook!.staff_id, rebook: true });
                setStep('time');
              }}
              data-testid="rebook-shortcut"
            >
              <Avatar
                name={options.rebook.name}
                url={mediaUrl(
                  options.staff.find((s) => s.id === options.rebook!.staff_id)?.photo_path,
                )}
              />
              <span>
                <span className="block font-semibold">Book again with {options.rebook.name}</span>
                <span className="text-sm text-ink-500">
                  Your last visit · {dayText(options.rebook.last_visit_at)}
                </span>
              </span>
            </button>
          ) : null}
          {options && options.choice_mode !== 'choose_only' ? (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-card border bg-surface-0 p-4 ${choice.mode === 'any' ? 'border-accent-600' : 'border-line-200'}`}
            >
              <input
                type="radio"
                name="who"
                className="mt-1"
                checked={choice.mode === 'any'}
                onChange={() => setChoice({ mode: 'any' })}
              />
              <span>
                <span className="block font-semibold">Any available staff</span>
                <span className="block text-sm text-success-600">
                  Recommended for fastest booking
                </span>
                <span className="text-sm text-ink-500">
                  {options.any_next
                    ? `Earliest: ${relativeDay(beirutParts(options.any_next).date, beirutDate(0))} ${timeText(options.any_next)}`
                    : 'No times in the next weeks'}
                </span>
              </span>
            </label>
          ) : null}
          {options && options.staff.length ? (
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-card border bg-surface-0 p-4 ${choice.mode === 'specific' ? 'border-accent-600' : 'border-line-200'}`}
            >
              <input
                type="radio"
                name="who"
                className="mt-1"
                checked={choice.mode === 'specific'}
                onChange={() =>
                  options.staff[0] && setChoice({ mode: 'specific', staffId: options.staff[0].id })
                }
              />
              <span className="font-semibold">Choose someone</span>
            </label>
          ) : null}
          {choice.mode === 'specific' && options ? (
            <ul className="flex flex-col gap-2" data-testid="staff-list">
              {options.staff
                .slice()
                .sort((a, c) => (a.next_available ? 0 : 1) - (c.next_available ? 0 : 1))
                .map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`flex w-full items-center gap-3 rounded-card border bg-surface-0 p-3 text-start ${choice.staffId === s.id ? 'border-accent-600' : 'border-line-200'} ${s.next_available ? '' : 'opacity-60'}`}
                      onClick={() => setChoice({ mode: 'specific', staffId: s.id })}
                    >
                      <Avatar name={s.name} url={mediaUrl(s.photo_path)} size="size-12" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{s.name}</span>
                        {s.role_title ? (
                          <span className="block text-sm text-ink-500">{s.role_title}</span>
                        ) : null}
                        {s.specialties.length ? (
                          <span className="block text-xs text-ink-500">
                            {s.specialties.join(' · ')}
                          </span>
                        ) : null}
                        <span className="block text-sm">
                          {s.next_available
                            ? `Next: ${relativeDay(beirutParts(s.next_available).date, beirutDate(0))} ${timeText(s.next_available)}`
                            : 'Fully booked for 14 days'}
                        </span>
                        {s.differs ? (
                          <span className="text-xs text-ink-500">
                            {priceText(s)} · {durationText(s.duration_min)}
                          </span>
                        ) : null}
                        {s.appointments ? (
                          <span className="block text-xs text-ink-500">
                            {s.appointments}+ appointments
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
          <div className="fixed inset-x-0 bottom-0 border-t border-line-200 bg-surface-0 p-3">
            <div className="mx-auto max-w-xl">
              <button
                type="button"
                className={primary}
                disabled={!options}
                onClick={() => setStep('time')}
                data-testid="staff-continue"
              >
                Continue
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === 'time' && service ? (
        <section className="flex flex-col gap-3" data-testid="step-time">
          {header(3, 'Time')}
          <p className="text-sm text-ink-700">
            {service.name} · {durationText(service.duration_min)} ·{' '}
            {choice.mode === 'any' ? 'Any available' : `with ${staffName(staffId)}`}
          </p>
          {options && options.staff.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Staff">
              {options.choice_mode !== 'choose_only' ? (
                <button
                  type="button"
                  className={chip(choice.mode === 'any')}
                  onClick={() => setChoice({ mode: 'any' })}
                >
                  Any available
                </button>
              ) : null}
              {options.staff.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={chip(staffId === s.id)}
                  onClick={() => setChoice({ mode: 'specific', staffId: s.id })}
                >
                  {s.name.split(' ')[0]}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="date-strip">
            {Array.from({ length: 14 }, (_, i) => addDays(beirutDate(0), i)).map((d) => {
              const has = days?.has(d) ?? false;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={!has}
                  className={`flex w-14 shrink-0 flex-col items-center rounded-control border py-2 text-xs ${date === d ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200 bg-surface-0'} disabled:opacity-40`}
                  onClick={() => setDate(d)}
                  aria-label={relativeDay(d, beirutDate(0))}
                >
                  <span>
                    {new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
                      new Date(`${d}T12:00:00Z`),
                    )}
                  </span>
                  <span className="text-base font-semibold">{Number(d.slice(8))}</span>
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
          <p className="text-xs text-ink-500">
            Times shown in Beirut time.
            {rules.min_notice_minutes >= 60
              ? ` Bookings need ${Math.round(rules.min_notice_minutes / 60)}h notice.`
              : ''}
          </p>
          {slots === null ? (
            <div className="grid grid-cols-4 gap-2" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="h-11 animate-pulse rounded-control bg-surface-100" />
              ))}
            </div>
          ) : !slots.length ? (
            <div
              className="rounded-card border border-line-200 bg-surface-0 p-4 text-sm"
              data-testid="no-slots"
            >
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
                    {relativeDay(beirutParts(nextAfter).date, beirutDate(0))} {timeText(nextAfter)}{' '}
                    →
                  </button>
                </>
              ) : l.whatsapp ? (
                <>
                  {' '}
                  <a
                    className="font-semibold text-accent-600"
                    href={waLink(l.whatsapp, `Hi! Do you have a time for ${service.name}?`) ?? '#'}
                  >
                    Ask on WhatsApp
                  </a>
                </>
              ) : null}
            </div>
          ) : (
            (['Morning', 'Afternoon', 'Evening'] as const).map((part) => {
              const inPart = slots.filter((s) => {
                const m = beirutParts(s).minutes;
                return part === 'Morning'
                  ? m < 720
                  : part === 'Afternoon'
                    ? m >= 720 && m < 1020
                    : m >= 1020;
              });
              if (!inPart.length) return null;
              return (
                <div key={part} className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-ink-700">{part}</p>
                  <div className="grid grid-cols-4 gap-2" data-testid="slots">
                    {inPart.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={busy || (hasSession === false && !captcha)}
                        className="h-11 rounded-control border border-line-200 bg-surface-0 text-sm font-medium hover:border-accent-600 disabled:opacity-50"
                        onClick={() => void takeSlot(s)}
                      >
                        {timeText(s)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })
          )}
          {rules.booking_mode === 'request' ? (
            <p className="text-xs text-ink-500">{b.name} confirms each request.</p>
          ) : null}
        </section>
      ) : null}

      {step === 'review' && service && hold ? (
        <Review
          page={page}
          service={service}
          hold={hold}
          options={options}
          choiceMode={choice.mode}
          header={header(4, 'Review')}
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

      {toast ? (
        <div
          role="status"
          data-testid="toast"
          className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-control bg-ink-900 px-4 py-3 text-sm text-white"
        >
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function Review({
  page,
  service,
  hold,
  options,
  choiceMode,
  header,
  onHold,
  onBack,
  onRetake,
}: {
  page: BusinessPage;
  service: PublicService;
  hold: Hold;
  options: StaffOptions | null;
  choiceMode: 'any' | 'specific';
  header: ReactNode;
  onHold: (h: Hold) => void;
  onBack: (msg?: string) => void;
  onRetake: (start: string) => void;
}) {
  const router = useRouter();
  const { business: b, rules } = page;
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
      {header}
      <p
        className={`text-sm ${expired ? 'text-danger-600' : 'text-ink-500'}`}
        data-testid="hold-timer"
      >
        {expired
          ? 'Your hold expired.'
          : `We’re holding this time for ${mm}:${String(ss).padStart(2, '0')}`}
      </p>
      <div
        className="flex flex-col gap-2 rounded-card border border-line-200 bg-surface-0 p-4"
        data-testid="summary"
      >
        <p className="font-semibold">{b.name}</p>
        <p>{service.name}</p>
        <p data-testid="summary-staff">
          {choiceMode === 'any' ? (
            <>
              You’ll be with <span className="font-semibold">{hold.staff_first_name}</span>
              <span className="block text-xs text-ink-500">
                Assigned from available staff ·{' '}
                {others.length ? (
                  <button
                    type="button"
                    className="font-medium text-accent-600"
                    onClick={() => setChanging((c) => !c)}
                  >
                    Change
                  </button>
                ) : null}
              </span>
            </>
          ) : (
            <>
              with <span className="font-semibold">{hold.staff_first_name}</span>
            </>
          )}
        </p>
        {changing ? (
          <ul className="flex flex-wrap gap-2">
            {others.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={chip(false)}
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
              </li>
            ))}
          </ul>
        ) : null}
        <p data-testid="summary-time">
          {dayText(hold.starts_at)} · {timeText(hold.starts_at)}–{timeText(hold.ends_at)}
        </p>
        <p className="text-sm text-ink-700">
          {priceText({ ...hold, currency: service.currency })} · Pay at the venue
        </p>
      </div>

      {expired ? (
        <button type="button" className={primary} onClick={() => onRetake(hold.starts_at)}>
          Check if {timeText(hold.starts_at)} is still free
        </button>
      ) : null}

      <div className="flex flex-col gap-3 rounded-card border border-line-200 bg-surface-0 p-4">
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
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">First name</span>
              <input
                className="h-11 rounded-control border border-line-200 px-3"
                value={first}
                maxLength={50}
                onChange={(e) => setFirst(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Last name (optional)</span>
              <input
                className="h-11 rounded-control border border-line-200 px-3"
                value={last}
                maxLength={50}
                onChange={(e) => setLast(e.target.value)}
              />
            </label>
          </div>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Note to {b.name} (optional)</span>
          <textarea
            className="h-20 rounded-control border border-line-200 p-3"
            maxLength={200}
            placeholder="e.g. I’d like to keep the length"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 text-sm text-ink-700" data-testid="policy">
        {request ? (
          <p>
            {b.name} will confirm your request, usually within{' '}
            {Math.max(1, Math.round(rules.request_expiry_minutes / 60))} hours.
          </p>
        ) : null}
        <p>
          {cancelHours > 0
            ? `Free cancellation until ${cancelHours}h before.`
            : 'Free cancellation until the appointment starts.'}
        </p>
        <p>You’ll get a confirmation and a reminder on WhatsApp.</p>
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
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger-600" data-testid="review-error">
          {error}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 border-t border-line-200 bg-surface-0 p-3">
        <div className="mx-auto max-w-xl">
          <button
            type="button"
            className={primary}
            disabled={busy || !verified || expired || (needName && !first.trim())}
            onClick={() => void confirm()}
            data-testid="confirm-booking"
          >
            {busy ? 'Booking…' : request ? 'Send request' : 'Confirm booking'}
            {!busy && hold.price_min !== null && hold.price_type !== 'on_consultation'
              ? ` · ${money(hold.price_min, service.currency)}`
              : ''}
          </button>
        </div>
      </div>
    </section>
  );
}
