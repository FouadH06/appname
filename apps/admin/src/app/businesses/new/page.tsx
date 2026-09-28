'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getMyAccess } from '@app/api';
import { messageForCode } from '@app/i18n';
import { getPublicEnv } from '@/env';
import { inLebanon, parsePin } from '@/lib/pin';
import { supabase } from '@/lib/supabase';

// A4 (minimal, M5): create a draft business, then send the owner invite. Ops then completes the B1
// wizard in the business dashboard as a temporary manager until the owner claims it.
const field = 'h-10 w-full rounded-control border border-line-200 bg-surface-0 px-3 text-sm';
const primary =
  'h-10 rounded-control bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50';

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

interface Option {
  id: string;
  slug?: string;
  name_en: string;
}

export default function NewBusinessPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [categories, setCategories] = useState<Option[]>([]);
  const [areas, setAreas] = useState<Option[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [pinRaw, setPinRaw] = useState('');
  const [phone, setPhone] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [created, setCreated] = useState<{
    businessId: string;
    invite?: { url: string; phone: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = supabase();
    void (async () => {
      const access = await getMyAccess(c).catch(() => null);
      if (!access?.admin_mfa_ok || !['ops', 'superadmin'].includes(access.admin_role ?? '')) {
        router.replace('/login');
        return;
      }
      const [cats, ar] = await Promise.all([
        c
          .from('categories')
          .select('id, slug, name_en')
          .not('parent_id', 'is', null)
          .eq('is_live', true)
          .order('sort'),
        c.from('areas').select('id, name_en').eq('level', 'area').order('name_en'),
      ]);
      setCategories((cats.data ?? []) as Option[]);
      setAreas((ar.data ?? []) as Option[]);
      setReady(true);
    })();
  }, [router]);

  const pin = parsePin(pinRaw);
  const describe = (code: string) =>
    code === 'SLUG_UNAVAILABLE'
      ? 'That booking link is taken or reserved.'
      : code === 'PIN_OUTSIDE_LEBANON'
        ? 'The pin is outside Lebanon.'
        : messageForCode('en', code);

  const create = async () => {
    setError(null);
    if (!name.trim() || !slug || !category || !area)
      return setError('Name, link, category and area are required.');
    if (!pin || !inLebanon(pin))
      return setError('Paste coordinates or a Google Maps link inside Lebanon.');
    setBusy(true);
    const c = supabase();
    const { data, error: err } = await c.rpc('admin_create_business', {
      p_name: name.trim(),
      p_slug: slug,
      p_category_slug: category,
      p_area_id: area,
      p_address_line: address,
      p_lat: pin.lat,
      p_lng: pin.lng,
      p_phone: phone || undefined,
    });
    if (err) {
      setBusy(false);
      return setError(describe(err.code === 'P0001' ? err.message : 'UNKNOWN'));
    }
    const businessId = (data as { business_id: string }).business_id;
    let invite: { url: string; phone: string } | undefined;
    if (ownerPhone.trim()) {
      const r = await c.rpc('invite_member', {
        p_business_id: businessId,
        p_phone: ownerPhone,
        p_role: 'owner',
      });
      if (r.error)
        setError(`Business created, but the owner invite failed: ${describe(r.error.message)}`);
      else {
        const res = r.data as { token: string; phone_e164: string };
        invite = {
          url: `${getPublicEnv().NEXT_PUBLIC_WEB_URL}/invite/${res.token}`,
          phone: res.phone_e164,
        };
      }
    }
    setBusy(false);
    setCreated({ businessId, invite });
  };

  if (!ready) return null;
  const webUrl = getPublicEnv().NEXT_PUBLIC_WEB_URL;

  if (created) {
    const text = created.invite
      ? `Welcome to APP_NAME! Claim ${name} and manage your bookings: ${created.invite.url}`
      : '';
    return (
      <main
        className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10"
        data-testid="business-created"
      >
        <h1 className="text-2xl font-semibold">{name} created (draft)</h1>
        <a
          className={primary + ' flex items-center justify-center'}
          href={`${webUrl}/biz/${created.businessId}/setup`}
          target="_blank"
          rel="noreferrer"
        >
          Open the setup wizard
        </a>
        {created.invite ? (
          <div
            className="flex flex-col gap-2 rounded-card border border-line-200 p-4 text-sm"
            data-testid="owner-invite"
          >
            <p className="font-medium">Owner invite</p>
            <code className="break-all">{created.invite.url}</code>
            <a
              className="text-accent-600"
              href={`https://wa.me/${created.invite.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
            >
              Send on WhatsApp
            </a>
          </div>
        ) : null}
        {error ? <p className="text-sm text-danger-600">{error}</p> : null}
        <Link href="/" className="text-sm text-accent-600">
          ← Admin home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Create business</h1>
      <p className="text-sm text-ink-500">
        Assisted onboarding: create a draft, send the owner invite, then finish the wizard with
        them.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Business name
        <input
          className={field}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugify(e.target.value));
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Booking link (platform.com/…)
        <input
          className={field}
          dir="ltr"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Category
        <select className={field} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name_en}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Area
        <select className={field} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Choose…</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name_en}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Street / building
        <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Map pin (coordinates or Google Maps link)
        <input
          className={field}
          dir="ltr"
          value={pinRaw}
          placeholder="33.8547, 35.5323"
          onChange={(e) => setPinRaw(e.target.value)}
        />
        <span className={pin && inLebanon(pin) ? 'text-success-600' : 'text-ink-500'}>
          {pin
            ? `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}${inLebanon(pin) ? '' : ' (outside Lebanon)'}`
            : 'The owner can drag the pin in the wizard later.'}
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Business phone (optional)
        <input
          className={field}
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Owner phone (sends the owner invite)
        <input
          className={field}
          type="tel"
          dir="ltr"
          value={ownerPhone}
          onChange={(e) => setOwnerPhone(e.target.value)}
        />
      </label>
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
      <button type="button" className={primary} disabled={busy} onClick={() => void create()}>
        Create business
      </button>
    </main>
  );
}
