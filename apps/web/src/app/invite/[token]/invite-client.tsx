'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { acceptInvitation, getInvitation, type InvitationPreview } from '@app/api';
import { Card, primaryButton } from '@/components/card';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { describeError, format, t } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// Team invite link from WhatsApp (Phase 2 B1 step 1 / B7 access). Accepting requires an
// OTP-verified session on the invited number; the server checks the match.
export function InviteClient({ token }: { token: string }) {
  const { loading, signedIn } = useSession();
  const [invite, setInvite] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInvitation(supabase(), token)
      .then(setInvite)
      .catch((e: { code?: string }) => setError(describeError(e.code ?? 'INVITE_INVALID')));
  }, [token]);

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptInvitation(supabase(), token);
      setAccepted(true);
    } catch (e) {
      setError(
        describeError((e as { code?: string }).code ?? 'UNKNOWN', {
          hint: invite?.phone_hint ?? '',
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [token, invite]);

  if (!invite) {
    return (
      <Card title="…">{error ? <p className="text-sm text-danger-600">{error}</p> : null}</Card>
    );
  }
  const title = format(t.pages.invite.title, { business: invite.business_name });
  const subtitle = format(t.pages.invite.role, { role: t.roles[invite.role] });

  if (accepted) {
    return (
      <Card title={title}>
        <p className="text-ink-900" data-testid="invite-accepted">
          {format(t.pages.invite.accepted, { business: invite.business_name })}
        </p>
        <Link href="/biz" className={primaryButton + ' flex items-center justify-center'}>
          {t.pages.invite.goToDashboard}
        </Link>
      </Card>
    );
  }
  if (invite.state !== 'valid') {
    const msg =
      invite.state === 'expired'
        ? t.pages.invite.expired
        : invite.state === 'revoked'
          ? t.pages.invite.revoked
          : t.pages.invite.used;
    return (
      <Card title={title} subtitle={subtitle}>
        <p className="text-sm text-ink-700">{msg}</p>
      </Card>
    );
  }

  return (
    <Card title={title} subtitle={subtitle}>
      {loading ? null : signedIn ? (
        <button
          type="button"
          className={primaryButton}
          disabled={busy}
          onClick={() => void accept()}
        >
          {t.pages.invite.accept}
        </button>
      ) : (
        <>
          <p className="text-sm text-ink-700">
            {format(t.pages.invite.signInWith, { hint: invite.phone_hint })}
          </p>
          <PhoneSignIn onVerified={() => void accept()} />
        </>
      )}
      {error ? (
        <p className="text-sm text-danger-600" role="alert" data-testid="invite-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
