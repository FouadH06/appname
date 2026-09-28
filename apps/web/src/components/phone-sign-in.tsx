'use client';

import { useRef } from 'react';
import { requestPhoneOtp, verifyPhoneOtp, type OtpMode } from '@app/api';
import { PhoneOtpFlow } from '@app/ui-web';
import { getPublicEnv } from '@/env';
import { describeError, locale, otpLabels } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

/**
 * Phone sign-in wired to Supabase Auth. An anonymous visitor's phone is linked to the same user;
 * a number that already has an account signs into it (see @app/api requestPhoneOtp).
 */
export function PhoneSignIn({
  onVerified,
  initialPhone,
  beforeRequest,
}: {
  onVerified: (phoneE164: string) => void;
  initialPhone?: string;
  /** e.g. extend the hold to 10 minutes when a code is requested (Part 3 §4.2) */
  beforeRequest?: () => Promise<void>;
}) {
  const mode = useRef<OtpMode>('signin');
  return (
    <PhoneOtpFlow
      siteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      labels={otpLabels}
      describeError={(code) => describeError(code)}
      initialPhone={initialPhone}
      requestOtp={async (phone, captchaToken) => {
        await beforeRequest?.();
        const r = await requestPhoneOtp(supabase(), phone, { captchaToken, locale });
        mode.current = r.mode;
      }}
      verifyOtp={(phone, code) => verifyPhoneOtp(supabase(), phone, code, mode.current)}
      onVerified={onVerified}
    />
  );
}
