'use client';

import { useState } from 'react';
import { ensureAnonymousSession } from '@app/api';
import { Turnstile } from '@app/ui-web';
import { Card, primaryButton, secondaryButton } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { getPublicEnv } from '@/env';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

interface Hold {
  booking_id: string;
  hold_token: string;
  staff_first_name: string;
  starts_at: string;
  expires_at: string;
}
type Step = 'start' | 'slots' | 'verify' | 'name' | 'done';

const TZ = 'Asia/Beirut';
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
const beirutDate = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

function inAppBrowser(ua: string): string {
  if (/Instagram/i.test(ua)) return 'Instagram in-app';
  if (/musical_ly|Bytedance|TikTok/i.test(ua)) return 'TikTok in-app';
  if (/FBAN|FBAV/i.test(ua)) return 'Facebook in-app';
  if (/WhatsApp/i.test(ua)) return 'WhatsApp in-app';
  return 'browser';
}

function diagnostics() {
  let storage = 'ok';
  try {
    localStorage.setItem('lab-probe', '1');
    localStorage.removeItem('lab-probe');
  } catch {
    storage = 'blocked';
  }
  return {
    browser: inAppBrowser(navigator.userAgent),
    localStorage: storage,
    cookies: navigator.cookieEnabled ? 'on' : 'off',
    webOtp: 'OTPCredential' in window ? 'yes' : 'no',
    userAgent: navigator.userAgent,
  };
}

export function LabBooking({ locationId, serviceId }: { locationId: string; serviceId: string }) {
  const [step, setStep] = useState<Step>('start');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [hold, setHold] = useState<Hold | null>(null);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [result, setResult] = useState<{ ref: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<ReturnType<typeof diagnostics> | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const fail = (e: unknown) => {
    const err = (e ?? {}) as { code?: string; message?: string };
    const code = err.code && /^[A-Z_]+$/.test(err.code) ? err.code : (err.message ?? 'UNKNOWN');
    setError(describeError(code) + (err.message ? ` (${err.message})` : ''));
    setBusy(false);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await ensureAnonymousSession(supabase(), captcha ?? '');
      const { data, error: e } = await supabase().rpc('get_available_slots', {
        p_location_id: locationId,
        p_service_id: serviceId,
        p_date_from: beirutDate(0),
        p_date_to: beirutDate(6),
      });
      if (e) throw e;
      setSlots((data ?? []).map((r) => r.slot_start).slice(0, 12));
      setStep('slots');
      setBusy(false);
    } catch (e) {
      fail(e);
    }
  };

  const pick = async (slot: string) => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase().rpc('create_hold', {
      p_location_id: locationId,
      p_service_id: serviceId,
      p_start: slot,
    });
    const row = data?.[0];
    if (e || !row) {
      fail(e ?? { code: 'SLOT_TAKEN' });
      return;
    }
    setHold(row as Hold);
    const { data: s } = await supabase().auth.getSession();
    setStep(s.session && !s.session.user.is_anonymous ? 'name' : 'verify');
    setBusy(false);
  };

  const confirm = async () => {
    if (!hold) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase().rpc('confirm_booking', {
      p_booking_id: hold.booking_id,
      p_hold_token: hold.hold_token,
      p_first_name: first || undefined,
      p_last_name: last || undefined,
      p_idempotency_key: idempotencyKey,
    });
    if (e || !data) {
      fail(e);
      return;
    }
    setResult({ ref: data.ref, status: data.status });
    setStep('done');
    setBusy(false);
  };

  return (
    <Card
      title="Booking sign-in lab"
      subtitle="Anonymous hold → phone code → confirm (M4 test page)"
    >
      {step === 'start' ? (
        <>
          <Turnstile siteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY} onToken={setCaptcha} />
          <button
            type="button"
            className={primaryButton}
            disabled={busy || !captcha}
            onClick={() => void start()}
            data-testid="lab-start"
          >
            Start (anonymous session)
          </button>
        </>
      ) : null}

      {step === 'slots' ? (
        <ul className="grid grid-cols-2 gap-2" data-testid="lab-slots">
          {slots.length === 0 ? (
            <li className="text-sm text-ink-500">No slots in the next 7 days.</li>
          ) : null}
          {slots.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={secondaryButton}
                disabled={busy}
                onClick={() => void pick(s)}
              >
                {fmt(s)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {hold && step !== 'done' ? (
        <p
          className="rounded-control bg-surface-50 p-3 text-sm text-ink-900"
          data-testid="lab-hold"
        >
          Held {fmt(hold.starts_at)} with {hold.staff_first_name}
        </p>
      ) : null}

      {step === 'verify' && hold ? (
        <PhoneSignIn
          beforeRequest={async () => {
            await supabase().rpc('extend_hold', {
              p_booking_id: hold.booking_id,
              p_hold_token: hold.hold_token,
            });
          }}
          onVerified={() => setStep('name')}
        />
      ) : null}

      {step === 'name' ? (
        <>
          <input
            className="h-12 rounded-control border border-line-200 px-3"
            placeholder="First name"
            aria-label="First name"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          />
          <input
            className="h-12 rounded-control border border-line-200 px-3"
            placeholder="Last name (optional)"
            aria-label="Last name"
            value={last}
            onChange={(e) => setLast(e.target.value)}
          />
          <button
            type="button"
            className={primaryButton}
            disabled={busy}
            onClick={() => void confirm()}
            data-testid="lab-confirm"
          >
            Confirm booking
          </button>
        </>
      ) : null}

      {step === 'done' && result ? (
        <p className="text-ink-900" data-testid="lab-done">
          Booked: {result.ref} ({result.status})
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <details
        className="text-xs text-ink-500"
        data-testid="lab-diagnostics"
        onToggle={(e) => {
          if (e.currentTarget.open) setDiag(diagnostics());
        }}
      >
        <summary>Browser diagnostics</summary>
        {diag ? (
          <pre className="break-all whitespace-pre-wrap">{JSON.stringify(diag, null, 2)}</pre>
        ) : null}
      </details>
    </Card>
  );
}
