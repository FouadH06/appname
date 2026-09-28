import type { AppSupabaseClient } from './client';

/**
 * Phone sign-in used by the booking funnel, business login and invite/claim links.
 *
 * - Visitors start with an anonymous session (Turnstile-protected) so they can hold a slot.
 * - "link": an anonymous visitor verifies a phone → the SAME user is upgraded (keeps the hold).
 * - "signin": the number already belongs to an account → sign into that account instead. The hold
 *   is still confirmable because the hold token, not the user, proves ownership (Part 3 §4.3).
 */
export type OtpMode = 'link' | 'signin';

export type AuthErrorCode =
  | 'CAPTCHA_FAILED'
  | 'OTP_TOO_MANY'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_DELIVERY_FAILED'
  | 'PHONE_INVALID'
  | 'RESEND_TOO_SOON'
  | 'MFA_INVALID'
  | 'UNKNOWN';

export class AuthFlowError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    override readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'AuthFlowError';
  }
}

interface GoTrueErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/** Maps GoTrue / hook errors to stable codes that @app/i18n turns into copy. */
export function mapAuthError(e: unknown): AuthErrorCode {
  const err = (e ?? {}) as GoTrueErrorLike;
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();
  if (code === 'captcha_failed' || msg.includes('captcha')) return 'CAPTCHA_FAILED';
  if (
    msg.includes('otp_too_many') ||
    code === 'over_sms_send_rate_limit' ||
    code === 'over_request_rate_limit'
  )
    return 'OTP_TOO_MANY';
  if (code === 'otp_expired' || msg.includes('expired')) return 'OTP_EXPIRED';
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired') return 'MFA_INVALID';
  if (code === 'invalid_credentials' || (msg.includes('invalid') && msg.includes('token')))
    return 'OTP_INVALID';
  if (code === 'validation_failed' && msg.includes('phone')) return 'PHONE_INVALID';
  if (msg.includes('sms_not_available') || msg.includes('invalid_phone')) return 'PHONE_INVALID';
  if (msg.includes('otp_delivery_failed') || code === 'sms_send_failed' || code === 'hook_timeout')
    return 'OTP_DELIVERY_FAILED';
  if (err.status === 429 || msg.includes('you can only request this after'))
    return 'RESEND_TOO_SOON';
  return 'UNKNOWN';
}

const PHONE_TAKEN = new Set(['phone_exists', 'identity_already_exists']);

function isPhoneTaken(e: unknown): boolean {
  const err = (e ?? {}) as GoTrueErrorLike;
  return (
    PHONE_TAKEN.has(err.code ?? '') ||
    /already (been )?registered|already exists/i.test(err.message ?? '')
  );
}

/** Starts an anonymous session if there is none (web booking funnel). */
export async function ensureAnonymousSession(
  client: AppSupabaseClient,
  captchaToken: string,
): Promise<void> {
  const { data } = await client.auth.getSession();
  if (data.session) return;
  const { error } = await client.auth.signInAnonymously({ options: { captchaToken } });
  if (error) throw new AuthFlowError(mapAuthError(error), error);
}

/**
 * Sends a code to `phone` (E.164). Anonymous sessions try to link the phone to the current user;
 * a number that already has an account switches to signing in. `captchaToken` must be fresh
 * (Turnstile tokens are single-use).
 */
export async function requestPhoneOtp(
  client: AppSupabaseClient,
  phone: string,
  opts: { captchaToken: string; locale?: 'en' | 'ar' | 'fr' },
): Promise<{ mode: OtpMode }> {
  const { data } = await client.auth.getSession();
  const user = data.session?.user;
  if (user?.is_anonymous) {
    const { error } = await client.auth.updateUser({
      phone,
      data: { locale: opts.locale ?? 'en' },
    });
    if (!error) return { mode: 'link' };
    if (!isPhoneTaken(error)) throw new AuthFlowError(mapAuthError(error), error);
  }
  const { error } = await client.auth.signInWithOtp({
    phone,
    options: {
      captchaToken: opts.captchaToken,
      shouldCreateUser: true,
      data: { locale: opts.locale ?? 'en' },
    },
  });
  if (error) throw new AuthFlowError(mapAuthError(error), error);
  return { mode: 'signin' };
}

export async function verifyPhoneOtp(
  client: AppSupabaseClient,
  phone: string,
  token: string,
  mode: OtpMode,
): Promise<void> {
  const { error } = await client.auth.verifyOtp({
    phone,
    token,
    type: mode === 'link' ? 'phone_change' : 'sms',
  });
  if (error) throw new AuthFlowError(mapAuthError(error), error);
  // The upgraded JWT (is_anonymous=false) is needed before calling customer RPCs
  await client.auth.refreshSession();
}

// ─── Admin MFA (TOTP) ──────────────────────────────────────────────────────
export type MfaState =
  | { step: 'enroll'; factorId: string; qrCode: string; secret: string }
  | { step: 'challenge'; factorId: string }
  | { step: 'done' };

/** Admins must reach aal2 (private.is_admin). Enrolls a TOTP factor on first login. */
export async function startAdminMfa(client: AppSupabaseClient): Promise<MfaState> {
  const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel === 'aal2') return { step: 'done' };
  const factors = await client.auth.mfa.listFactors();
  const verified = factors.data?.totp.find((f) => f.status === 'verified');
  if (verified) return { step: 'challenge', factorId: verified.id };
  // Remove abandoned, unverified enrollments before starting a new one
  for (const f of factors.data?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified')
      await client.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator app',
  });
  if (error || !data) throw new AuthFlowError(mapAuthError(error), error);
  return { step: 'enroll', factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyAdminMfa(
  client: AppSupabaseClient,
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new AuthFlowError(mapAuthError(error), error);
}
