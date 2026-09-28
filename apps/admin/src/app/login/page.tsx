'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMyAccess,
  requestPhoneOtp,
  startAdminMfa,
  verifyAdminMfa,
  verifyPhoneOtp,
  type MfaState,
  type OtpMode,
} from '@app/api';
import { messageForCode, phoneOtpLabels } from '@app/i18n';
import { OtpInput, PhoneOtpFlow } from '@app/ui-web';
import { getPublicEnv } from '@/env';
import { supabase } from '@/lib/supabase';

// Admin sign-in: phone code, then TOTP (enrolled on first login). Admin RPCs require aal2
// (private.is_admin), so nothing works until MFA is verified (Phase 3 Part 6 §7).
type Step = 'loading' | 'phone' | 'not_admin' | 'mfa';

const describe = (code: string) => messageForCode('en', code);
const button =
  'h-11 w-full rounded-control bg-accent-600 px-4 font-semibold text-white disabled:opacity-50';

export default function AdminLoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [mfa, setMfa] = useState<MfaState | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mode = useRef<OtpMode>('signin');

  const afterPhone = useCallback(async () => {
    setError(null);
    try {
      const access = await getMyAccess(supabase());
      if (!access.admin_role) {
        setStep('not_admin');
        return;
      }
      if (access.admin_mfa_ok) {
        router.replace('/');
        return;
      }
      const state = await startAdminMfa(supabase());
      if (state.step === 'done') {
        router.replace('/');
        return;
      }
      setMfa(state);
      setStep('mfa');
    } catch (e) {
      setError(describe((e as { code?: string }).code ?? 'UNKNOWN'));
      setStep('phone');
    }
  }, [router]);

  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return; // once per page load (dev Strict Mode runs effects twice)
    checked.current = true;
    void supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session && !data.session.user.is_anonymous) void afterPhone();
        else setStep('phone');
      });
  }, [afterPhone]);

  const verifyTotp = async (value: string) => {
    if (!mfa || mfa.step === 'done' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyAdminMfa(supabase(), mfa.factorId, value);
      router.replace('/');
    } catch (e) {
      setCode('');
      setError(describe((e as { code?: string }).code ?? 'MFA_INVALID'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-xl font-semibold text-ink-900">APP_NAME Admin</h1>
      <div className="mt-6 flex flex-col gap-4" data-testid="admin-login" data-step={step}>
        {step === 'phone' ? (
          <PhoneOtpFlow
            siteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
            labels={phoneOtpLabels('en')}
            describeError={describe}
            requestOtp={async (phone, captchaToken) => {
              mode.current = (await requestPhoneOtp(supabase(), phone, { captchaToken })).mode;
            }}
            verifyOtp={(phone, c) => verifyPhoneOtp(supabase(), phone, c, mode.current)}
            onVerified={() => void afterPhone()}
          />
        ) : null}

        {step === 'not_admin' ? (
          <>
            <p className="text-sm text-ink-700" data-testid="not-admin">
              This account doesn&apos;t have admin access.
            </p>
            <button
              type="button"
              className={button}
              onClick={() =>
                void supabase()
                  .auth.signOut()
                  .then(() => setStep('phone'))
              }
            >
              Sign out
            </button>
          </>
        ) : null}

        {step === 'mfa' && mfa && mfa.step !== 'done' ? (
          <>
            {mfa.step === 'enroll' ? (
              <>
                <p className="text-sm font-medium text-ink-900">Set up your authenticator</p>
                <p className="text-sm text-ink-700">
                  Scan this QR code with Google Authenticator, 1Password or a similar app, then
                  enter the 6-digit code.
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Supabase */}
                <img src={mfa.qrCode} alt="Authenticator QR code" className="size-48 self-center" />
                <p className="text-xs break-all text-ink-500" data-testid="totp-secret">
                  Can&apos;t scan? Key: {mfa.secret}
                </p>
              </>
            ) : (
              <p className="text-sm font-medium text-ink-900">Enter your authenticator code</p>
            )}
            <OtpInput
              label="Authenticator code"
              value={code}
              onChange={setCode}
              onComplete={(c) => void verifyTotp(c)}
              disabled={busy}
              error={error}
            />
          </>
        ) : null}

        {error && step !== 'mfa' ? (
          <p className="text-sm text-danger-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
