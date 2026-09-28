'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { parsePhone } from '@app/core';
import { OtpInput } from './OtpInput';
import { PhoneInput } from './PhoneInput';
import { Turnstile } from './Turnstile';
import { flowReducer, initialFlow, secondsLeft } from './logic';

export interface PhoneOtpLabels {
  phoneLabel: string;
  phonePlaceholder: string;
  phoneHelp: string;
  phoneEmpty: string;
  phoneInvalid: string;
  phoneLbInvalid: string;
  phoneLandline: string;
  sendCode: string;
  otpLabel: string;
  /** "{phone}" is replaced */
  sentWhatsapp: string;
  sentSms: string;
  /** "{seconds}" is replaced */
  resendIn: string;
  resend: string;
  useSms: string;
  changeNumber: string;
  verify: string;
}

export interface PhoneOtpFlowProps {
  siteKey: string;
  labels: PhoneOtpLabels;
  /** Copy for a stable error code (AuthFlowError.code / RpcError.code). */
  describeError: (code: string) => string;
  /** Sends a code; must throw an error with a `code` property on failure. */
  requestOtp: (phoneE164: string, captchaToken: string) => Promise<void>;
  verifyOtp: (phoneE164: string, code: string) => Promise<void>;
  onVerified: (phoneE164: string) => void;
  initialPhone?: string;
}

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code ?? 'UNKNOWN';
const fill = (t: string, k: string, v: string | number) => t.replace(`{${k}}`, String(v));

function displayPhone(e164: string | null): string {
  if (!e164) return '';
  const p = parsePhone(e164);
  return p.ok ? p.phone.display : e164;
}

const primary =
  'h-12 w-full rounded-control bg-accent-600 px-4 text-base font-semibold text-white disabled:opacity-50';
const link =
  'text-sm font-medium text-accent-600 underline-offset-2 hover:underline disabled:opacity-50';

/**
 * Phone → WhatsApp code → verified. Used by the booking funnel, business login, invite and claim
 * links, and admin login. "Send by SMS instead" appears after 30 s for Lebanese numbers; the
 * server routes that resend to SMS. Every send carries a fresh Turnstile token.
 */
export function PhoneOtpFlow({
  siteKey,
  labels,
  describeError,
  requestOtp,
  verifyOtp,
  onVerified,
  initialPhone = '',
}: PhoneOtpFlowProps) {
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [raw, setRaw] = useState(initialPhone);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const verifying = useRef(false);

  useEffect(() => {
    if (state.step !== 'code') return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.step]);

  const takeToken = () => {
    const t = captcha;
    setCaptcha(null);
    setCaptchaReset((n) => n + 1); // single-use: ask Turnstile for the next one
    return t;
  };

  const send = async () => {
    const parsed = parsePhone(raw);
    if (!parsed.ok) {
      setFieldError(
        parsed.error === 'empty'
          ? labels.phoneEmpty
          : parsed.error === 'lb_invalid'
            ? labels.phoneLbInvalid
            : labels.phoneInvalid,
      );
      return;
    }
    if (!parsed.phone.canReceiveOtp) {
      setFieldError(labels.phoneLandline);
      return;
    }
    setFieldError(null);
    const token = takeToken();
    if (!token) {
      dispatch({ type: 'failed', error: describeError('CAPTCHA_FAILED') });
      return;
    }
    dispatch({ type: 'send', phone: parsed.phone.e164 });
    try {
      await requestOtp(parsed.phone.e164, token);
      setSentAt(Date.now());
      setNow(Date.now());
      dispatch({ type: 'sent' });
    } catch (e) {
      dispatch({ type: 'failed', error: describeError(codeOf(e)) });
    }
  };

  const resend = async () => {
    if (!state.phone) return;
    const token = takeToken();
    if (!token) {
      dispatch({ type: 'failed', error: describeError('CAPTCHA_FAILED') });
      return;
    }
    dispatch({ type: 'resend' });
    try {
      await requestOtp(state.phone, token);
      setSentAt(Date.now());
      setCode('');
      dispatch({ type: 'resent', channel: state.phone.startsWith('+961') ? 'sms' : 'whatsapp' });
    } catch (e) {
      dispatch({ type: 'failed', error: describeError(codeOf(e)) });
    }
  };

  const verify = useCallback(
    async (value: string) => {
      if (!state.phone || verifying.current) return;
      verifying.current = true;
      dispatch({ type: 'verify' });
      try {
        await verifyOtp(state.phone, value);
        dispatch({ type: 'verified' });
        onVerified(state.phone);
      } catch (e) {
        setCode('');
        dispatch({ type: 'failed', error: describeError(codeOf(e)) });
      } finally {
        verifying.current = false;
      }
    },
    [state.phone, verifyOtp, onVerified, describeError],
  );

  const wait = secondsLeft(sentAt, now);
  const display = displayPhone(state.phone);

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="phone-otp-flow"
      data-captcha={captcha ? 'ready' : 'pending'}
      data-step={state.step}
    >
      {state.step === 'phone' ? (
        <>
          <PhoneInput
            label={labels.phoneLabel}
            value={raw}
            onChange={setRaw}
            placeholder={labels.phonePlaceholder}
            help={labels.phoneHelp}
            error={fieldError}
            disabled={state.busy}
            autoFocus
            onEnter={() => void send()}
          />
          <button
            type="button"
            className={primary}
            disabled={state.busy}
            onClick={() => void send()}
          >
            {labels.sendCode}
          </button>
        </>
      ) : null}

      {state.step === 'code' ? (
        <>
          <p className="text-sm text-ink-700" data-testid="otp-sent">
            {fill(state.channel === 'sms' ? labels.sentSms : labels.sentWhatsapp, 'phone', display)}
          </p>
          <OtpInput
            label={labels.otpLabel}
            value={code}
            onChange={setCode}
            onComplete={(c) => void verify(c)}
            disabled={state.busy}
            webOtp={state.channel === 'sms'}
          />
          <button
            type="button"
            className={primary}
            disabled={state.busy || code.length !== 6}
            onClick={() => void verify(code)}
          >
            {labels.verify}
          </button>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className={link}
              onClick={() => {
                setCode('');
                dispatch({ type: 'change_number' });
              }}
            >
              {labels.changeNumber}
            </button>
            {wait > 0 ? (
              <span className="text-sm text-ink-500" aria-live="polite">
                {fill(labels.resendIn, 'seconds', wait)}
              </span>
            ) : (
              <button
                type="button"
                className={link}
                disabled={state.busy}
                onClick={() => void resend()}
              >
                {state.phone?.startsWith('+961') && state.channel === 'whatsapp'
                  ? labels.useSms
                  : labels.resend}
              </button>
            )}
          </div>
        </>
      ) : null}

      {state.error ? (
        <p className="text-sm text-danger-600" role="alert" data-testid="flow-error">
          {state.error}
        </p>
      ) : null}

      {state.step !== 'done' ? (
        <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaReset} />
      ) : null}
    </div>
  );
}
