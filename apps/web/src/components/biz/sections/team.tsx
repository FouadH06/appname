'use client';

import { useState } from 'react';
import { useBiz, type Role } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError, t } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Field, Notice, Section, btn, codeOf, input } from '../ui';

interface Member {
  user_id: string;
  role: Role;
  display_name: string;
  phone_hint: string | null;
  staff_name: string | null;
  is_me: boolean;
}
interface Invitation {
  invitation_id: string;
  phone_e164: string;
  role: Role;
  expires_at: string;
}

/** Team & roles (B12, mirrors Staff › Access). Managers can't touch owners or managers. */
export function TeamSection() {
  const { business, role: myRole } = useBiz();
  const { data, reload } = useLoad(async () => {
    const [m, i] = await Promise.all([
      supabase().rpc('list_members', { p_business_id: business.id }),
      supabase().rpc('list_invitations', { p_business_id: business.id }),
    ]);
    return { members: (m.data ?? []) as Member[], invites: (i.data ?? []) as Invitation[] };
  }, [business.id]);
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('reception');
  const [link, setLink] = useState<{ url: string; phone: string } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const canTouch = (r: Role) =>
    myRole === 'owner' ? r !== 'owner' : r === 'reception' || r === 'staff';

  const run = async (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) setMsg({ tone: 'danger', text: describeError(codeOf(error)) });
    else if (ok) setMsg({ tone: 'success', text: ok });
    await reload();
  };

  const invite = async () => {
    setBusy(true);
    setMsg(null);
    const { data: r, error } = await supabase().rpc('invite_member', {
      p_business_id: business.id,
      p_phone: phone,
      p_role: role,
    });
    setBusy(false);
    if (error) return setMsg({ tone: 'danger', text: describeError(codeOf(error)) });
    const res = r as { token: string; phone_e164: string };
    setLink({ url: `${window.location.origin}/invite/${res.token}`, phone: res.phone_e164 });
    setPhone('');
    await reload();
  };

  const roleOptions: Exclude<Role, 'owner'>[] =
    myRole === 'owner' ? ['manager', 'reception', 'staff'] : ['reception', 'staff'];

  return (
    <Section
      title="Team & roles"
      description="Who can sign in to this business, and what they can do."
    >
      <ul className="flex flex-col divide-y divide-line-200 text-sm" data-testid="team-list">
        {(data?.members ?? []).map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-40 flex-1">
              <span className="font-medium">{m.display_name}</span>
              {m.is_me ? ' (you)' : ''}
              <span className="block text-ink-500">
                {m.phone_hint ?? ''}
                {m.staff_name ? ` · staff profile: ${m.staff_name}` : ''}
              </span>
            </span>
            {canTouch(m.role) && !m.is_me ? (
              <>
                <select
                  className={input + ' w-36'}
                  value={m.role}
                  aria-label={`Role for ${m.display_name}`}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () =>
                        supabase().rpc('change_member_role', {
                          p_business_id: business.id,
                          p_user_id: m.user_id,
                          p_role: e.target.value as Role,
                        }),
                      'Role updated',
                    )
                  }
                >
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {t.roles[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        supabase().rpc('revoke_member', {
                          p_business_id: business.id,
                          p_user_id: m.user_id,
                        }),
                      'Access removed',
                    )
                  }
                >
                  Remove
                </button>
              </>
            ) : (
              <span className="text-ink-500">{t.roles[m.role]}</span>
            )}
          </li>
        ))}
      </ul>

      {data?.invites.length ? (
        <div className="text-sm">
          <p className="mb-1 font-medium">Pending invitations</p>
          <ul>
            {data.invites.map((i) => (
              <li key={i.invitation_id} className="flex items-center justify-between py-1">
                <span>
                  {i.phone_e164} · {t.roles[i.role]}
                </span>
                {canTouch(i.role) ? (
                  <button
                    type="button"
                    className={btn.link}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          supabase().rpc('revoke_invitation', { p_invitation_id: i.invitation_id }),
                        'Invitation cancelled',
                      )
                    }
                  >
                    Cancel
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Invite by phone">
          <input
            className={input}
            type="tel"
            dir="ltr"
            placeholder="70 123 456"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <select
            className={input}
            value={role}
            onChange={(e) => setRole(e.target.value as Exclude<Role, 'owner'>)}
          >
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {t.roles[r]}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={btn.primary}
          disabled={busy || !phone.trim()}
          onClick={() => void invite()}
        >
          Create invite
        </button>
      </div>
      {link ? <InviteShare url={link.url} phone={link.phone} business={business.name} /> : null}
      <p className="text-xs text-ink-500">
        To give someone a staff calendar, invite them from their profile in Staff › Access.
      </p>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </Section>
  );
}

export function InviteShare({
  url,
  phone,
  business,
}: {
  url: string;
  phone: string;
  business: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = `You're invited to ${business} on APP_NAME. Sign in with this number: ${url}`;
  return (
    <div
      className="flex flex-col gap-2 rounded-control bg-surface-50 p-3 text-sm"
      data-testid="invite-link"
    >
      <code className="break-all">{url}</code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn.secondary}
          onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <a
          className={btn.primary}
          href={`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
        >
          Send on WhatsApp
        </a>
      </div>
      <span className="text-xs text-ink-500">
        Automatic WhatsApp sending arrives with notifications (M7).
      </span>
    </div>
  );
}
