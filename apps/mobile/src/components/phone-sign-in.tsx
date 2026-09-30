import { useState } from 'react';
import { Text, View } from 'react-native';
import { AuthFlowError, requestPhoneOtp, verifyPhoneOtp, type OtpMode } from '@app/api';
import { toE164 } from '@app/core';
import { messageForCode } from '@app/i18n';
import { Captcha } from '@/components/captcha';
import { Body, Button, C, Field, Muted } from '@/components/ui';
import { supabase } from '@/lib/supabase';

// Phone → code (WhatsApp, SMS fallback). An anonymous session (holding a slot) is upgraded in place.
export function PhoneSignIn({ onVerified, intro }: { onVerified: () => void; intro?: string }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [sent, setSent] = useState<{ e164: string; mode: OtpMode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const e164 = toE164(phone);
    if (!e164) return setError(messageForCode('en', 'PHONE_INVALID'));
    if (!captcha) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestPhoneOtp(supabase(), e164, { captchaToken: captcha });
      setSent({ e164, mode: r.mode });
    } catch (e) {
      setError(messageForCode('en', e instanceof AuthFlowError ? e.code : 'UNKNOWN'));
      setCaptcha(null);
      setNonce((n) => n + 1); // Turnstile tokens are single-use
    } finally {
      setBusy(false);
    }
  };
  const verify = async (value: string) => {
    if (!sent || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneOtp(supabase(), sent.e164, value, sent.mode);
      onVerified();
    } catch (e) {
      setError(messageForCode('en', e instanceof AuthFlowError ? e.code : 'UNKNOWN'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }} testID="phone-sign-in">
      {intro ? <Body>{intro}</Body> : null}
      {!sent ? (
        <>
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="70 123 456" autoComplete="tel" textContentType="telephoneNumber" />
          <Captcha onToken={setCaptcha} nonce={nonce} />
          <Button title="Send code" onPress={() => void send()} busy={busy} disabled={!captcha || !phone.trim()} testID="send-code" />
          <Muted>We&apos;ll send you a code on WhatsApp.</Muted>
        </>
      ) : (
        <>
          <Muted>Code sent to {sent.e164}.</Muted>
          <Field label="6-digit code" value={code} keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode"
            onChangeText={(v) => {
              const d = v.replace(/\D/g, '').slice(0, 6);
              setCode(d);
              if (d.length === 6) void verify(d);
            }} />
          <Button title="Use another number" kind="secondary" onPress={() => { setSent(null); setCode(''); setCaptcha(null); setNonce((n) => n + 1); }} />
        </>
      )}
      {error ? (
        <Text style={{ color: C.danger }} testID="auth-error" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
