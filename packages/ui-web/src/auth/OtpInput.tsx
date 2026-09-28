'use client';

import { useEffect, useId } from 'react';
import { OTP_LENGTH, sanitizeOtp } from './logic';

export interface OtpInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called once 6 digits are present (typed, pasted or autofilled). */
  onComplete: (code: string) => void;
  error?: string | null;
  disabled?: boolean;
  /** Listen for the SMS through the Web OTP API (Android Chrome) while an SMS code is expected. */
  webOtp?: boolean;
}

interface OtpCredential extends Credential {
  code: string;
}

/**
 * One input (not six boxes): the most reliable way to get iOS/Android one-time-code autofill,
 * paste and screen-reader support, including inside Instagram/TikTok in-app browsers.
 */
export function OtpInput({
  label,
  value,
  onChange,
  onComplete,
  error,
  disabled,
  webOtp,
}: OtpInputProps) {
  const id = useId();

  useEffect(() => {
    if (!webOtp || typeof window === 'undefined' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const code = sanitizeOtp((cred as OtpCredential | null)?.code ?? '');
        if (code.length === OTP_LENGTH) {
          onChange(code);
          onComplete(code);
        }
      })
      .catch(() => undefined); // aborted or unsupported: typing still works
    return () => ac.abort();
  }, [webOtp, onChange, onComplete]);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-900">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        dir="ltr"
        maxLength={OTP_LENGTH + 8 /* allow pasting "123 456" before sanitizing */}
        value={value}
        disabled={disabled}
        autoFocus
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          const code = sanitizeOtp(e.target.value);
          onChange(code);
          if (code.length === OTP_LENGTH) onComplete(code);
        }}
        className="h-14 rounded-control border border-line-200 bg-surface-0 px-3 text-center font-mono text-2xl tracking-[0.5em] text-ink-900 outline-none focus:border-accent-600 aria-[invalid]:border-danger-600 disabled:opacity-60"
      />
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
