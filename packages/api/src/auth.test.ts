import { describe, expect, it, vi } from 'vitest';
import type { AppSupabaseClient } from './client';
import {
  AuthFlowError,
  ensureAnonymousSession,
  mapAuthError,
  requestPhoneOtp,
  startAdminMfa,
  verifyPhoneOtp,
} from './auth';
import { RpcError, toRpcError } from './identity';

type Fn = ReturnType<typeof vi.fn>;

function fakeClient(opts: {
  session?: { user: { is_anonymous: boolean } } | null;
  updateUserError?: unknown;
  otpError?: unknown;
}) {
  const auth = {
    getSession: vi.fn(() => Promise.resolve({ data: { session: opts.session ?? null } })),
    signInAnonymously: vi.fn(() => Promise.resolve({ error: null })),
    updateUser: vi.fn(() => Promise.resolve({ error: opts.updateUserError ?? null })),
    signInWithOtp: vi.fn(() => Promise.resolve({ error: opts.otpError ?? null })),
    verifyOtp: vi.fn(() => Promise.resolve({ error: null })),
    refreshSession: vi.fn(() => Promise.resolve({ error: null })),
    mfa: {
      getAuthenticatorAssuranceLevel: vi.fn(() =>
        Promise.resolve({ data: { currentLevel: 'aal1' } }),
      ),
      listFactors: vi.fn(() => Promise.resolve({ data: { totp: [], all: [] } })),
      enroll: vi.fn(() =>
        Promise.resolve({
          data: { id: 'f1', totp: { qr_code: 'data:image/svg+xml;...', secret: 'ABC' } },
          error: null,
        }),
      ),
      unenroll: vi.fn(() => Promise.resolve({ error: null })),
    },
  };
  return { client: { auth } as unknown as AppSupabaseClient, auth };
}

describe('phone OTP flow', () => {
  it('starts an anonymous session with the captcha token only when needed', async () => {
    const { client, auth } = fakeClient({ session: null });
    await ensureAnonymousSession(client, 'cap-1');
    expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'cap-1' } });
    const signedIn = fakeClient({ session: { user: { is_anonymous: true } } });
    await ensureAnonymousSession(signedIn.client, 'cap-2');
    expect(signedIn.auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('anonymous visitor: links the phone to the same user (keeps the hold)', async () => {
    const { client, auth } = fakeClient({ session: { user: { is_anonymous: true } } });
    expect(
      await requestPhoneOtp(client, '+96170123456', { captchaToken: 'c', locale: 'ar' }),
    ).toEqual({ mode: 'link' });
    expect(auth.updateUser).toHaveBeenCalledWith({ phone: '+96170123456', data: { locale: 'ar' } });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('number already registered: switches to signing into that account', async () => {
    const { client, auth } = fakeClient({
      session: { user: { is_anonymous: true } },
      updateUserError: {
        code: 'phone_exists',
        status: 422,
        message: 'Phone number already registered',
      },
    });
    expect(await requestPhoneOtp(client, '+96170123456', { captchaToken: 'c2' })).toEqual({
      mode: 'signin',
    });
    expect((auth.signInWithOtp as Fn).mock.calls[0]![0]).toMatchObject({
      phone: '+96170123456',
      options: { captchaToken: 'c2', shouldCreateUser: true },
    });
  });

  it('no session (business login): signs in with OTP', async () => {
    const { client, auth } = fakeClient({ session: null });
    expect(await requestPhoneOtp(client, '+96170123456', { captchaToken: 'c' })).toEqual({
      mode: 'signin',
    });
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('surfaces hook refusals as stable codes', async () => {
    const { client } = fakeClient({
      session: null,
      otpError: { status: 429, message: 'OTP_TOO_MANY' },
    });
    await expect(
      requestPhoneOtp(client, '+96170123456', { captchaToken: 'c' }),
    ).rejects.toMatchObject({
      code: 'OTP_TOO_MANY',
    });
  });

  it('verifies with the right OTP type and refreshes the session', async () => {
    const { client, auth } = fakeClient({});
    await verifyPhoneOtp(client, '+96170123456', '123456', 'link');
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      phone: '+96170123456',
      token: '123456',
      type: 'phone_change',
    });
    await verifyPhoneOtp(client, '+96170123456', '123456', 'signin');
    expect((auth.verifyOtp as Fn).mock.calls[1]![0]).toMatchObject({ type: 'sms' });
    expect(auth.refreshSession).toHaveBeenCalledTimes(2);
  });
});

describe('mapAuthError', () => {
  it.each([
    [{ code: 'captcha_failed' }, 'CAPTCHA_FAILED'],
    [{ code: 'otp_expired', message: 'Token has expired or is invalid' }, 'OTP_EXPIRED'],
    [{ code: 'over_sms_send_rate_limit' }, 'OTP_TOO_MANY'],
    [{ message: 'OTP_DELIVERY_FAILED' }, 'OTP_DELIVERY_FAILED'],
    [
      {
        status: 429,
        message: 'For security purposes, you can only request this after 21 seconds.',
      },
      'RESEND_TOO_SOON',
    ],
    [{ code: 'mfa_verification_failed' }, 'MFA_INVALID'],
    [{ message: 'something else' }, 'UNKNOWN'],
  ])('%o → %s', (err, code) => {
    expect(mapAuthError(err)).toBe(code);
  });
});

describe('admin MFA', () => {
  it('enrolls TOTP on first login', async () => {
    const { client } = fakeClient({});
    expect(await startAdminMfa(client)).toEqual({
      step: 'enroll',
      factorId: 'f1',
      qrCode: 'data:image/svg+xml;...',
      secret: 'ABC',
    });
  });

  it('challenges an existing verified factor', async () => {
    const { client, auth } = fakeClient({});
    (auth.mfa.listFactors as Fn).mockResolvedValueOnce({
      data: { totp: [{ id: 'f9', status: 'verified' }], all: [] },
    });
    expect(await startAdminMfa(client)).toEqual({ step: 'challenge', factorId: 'f9' });
  });
});

describe('RPC errors', () => {
  it('extracts the stable code and JSON detail', () => {
    const e = toRpcError({ code: 'P0001', message: 'CLAIM_PHONE_MISMATCH', details: '{"x":1}' });
    expect(e).toBeInstanceOf(RpcError);
    expect(e.code).toBe('CLAIM_PHONE_MISMATCH');
    expect(e.detail).toEqual({ x: 1 });
    expect(toRpcError({ code: '42501', message: 'permission denied' }).code).toBe('AUTH_REQUIRED');
  });

  it('AuthFlowError keeps the code', () => {
    expect(new AuthFlowError('OTP_INVALID').code).toBe('OTP_INVALID');
  });
});
