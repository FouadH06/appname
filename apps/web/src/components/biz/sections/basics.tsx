'use client';

import { useEffect, useState } from 'react';
import type { Enums } from '@app/db';
import { useBiz } from '@/lib/biz/context';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Field, Notice, Section, btn, codeOf, input } from '../ui';

/** Name → slug suggestion (Latin names; Arabic names need a typed slug). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

type SlugState = { available: boolean; reason: string | null; suggestions: string[] } | null;

/** Slug with live availability check and suggestions (Phase 2 B1 step 2). */
export function SlugField({
  value,
  onChange,
  businessId,
}: {
  value: string;
  onChange: (v: string) => void;
  businessId?: string;
}) {
  const [state, setState] = useState<SlugState>(null);
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => {
      void supabase()
        .rpc('check_slug', { p_slug: value, p_business_id: businessId })
        .then(({ data }) => setState((data as SlugState) ?? null));
    }, 300);
    return () => clearTimeout(t);
  }, [value, businessId]);

  const hint = !value
    ? 'Your booking link: platform.com/your-name'
    : state?.available
      ? `platform.com/${value} is available`
      : state?.reason === 'reserved'
        ? 'That word is reserved.'
        : state?.reason === 'invalid'
          ? 'Use lowercase letters, numbers and dashes (3–50).'
          : state?.reason === 'taken'
            ? 'Already taken.'
            : ' ';
  return (
    <Field label="Booking link" hint={hint}>
      <div className="flex items-center gap-1">
        <span className="text-sm text-ink-500">platform.com/</span>
        <input
          className={input}
          value={value}
          dir="ltr"
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          aria-label="Booking link"
        />
      </div>
      {state && !state.available && state.suggestions.length ? (
        <span className="flex flex-wrap gap-2">
          {state.suggestions.map((s) => (
            <button key={s} type="button" className={btn.link} onClick={() => onChange(s)}>
              {s}
            </button>
          ))}
        </span>
      ) : null}
    </Field>
  );
}

export function BasicsSection({ onSaved }: { onSaved?: () => void }) {
  const { business, refresh } = useBiz();
  const [name, setName] = useState(business.name);
  const [slug, setSlug] = useState(business.slug);
  const [audience, setAudience] = useState<Enums<'audience'>>(business.audience);
  const [description, setDescription] = useState(business.description ?? '');
  const [instagram, setInstagram] = useState(business.instagram_handle ?? '');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (name.trim().length < 2) throw { message: 'NAME_REQUIRED' };
      const ig = instagram.trim().replace(/^@/, '');
      const { error } = await supabase()
        .from('businesses')
        .update({
          name: name.trim(),
          audience,
          description: description.trim() || null,
          instagram_handle: ig || null,
        })
        .eq('id', business.id);
      if (error) throw error;
      if (slug !== business.slug) {
        const r = await supabase().rpc('change_business_slug', {
          p_business_id: business.id,
          p_slug: slug,
        });
        if (r.error) throw r.error;
      }
      await refresh();
      setMsg({
        tone: 'success',
        text: slug !== business.slug ? 'Saved. Old links redirect to the new one.' : 'Saved',
      });
      onSaved?.();
    } catch (e) {
      const code = codeOf(e);
      setMsg({
        tone: 'danger',
        text:
          code === 'SLUG_UNAVAILABLE'
            ? 'That booking link is taken or reserved.'
            : code === 'NAME_REQUIRED'
              ? 'Enter your business name.'
              : describeError(code),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Business profile" description="How customers find and recognize you.">
      <Field label="Business name" hint="Arabic or English, as customers know you.">
        <input
          className={input}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <SlugField value={slug} onChange={setSlug} businessId={business.id} />
      <Field label="Serves">
        <select
          className={input}
          value={audience}
          onChange={(e) => setAudience(e.target.value as Enums<'audience'>)}
        >
          <option value="everyone">Everyone</option>
          <option value="women">Women</option>
          <option value="men">Men</option>
        </select>
      </Field>
      <Field label="Short description (optional)">
        <textarea
          className={input + ' h-24 py-2'}
          value={description}
          maxLength={1500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Instagram (optional)">
        <input
          className={input}
          value={instagram}
          dir="ltr"
          placeholder="@yourbusiness"
          onChange={(e) => setInstagram(e.target.value)}
        />
      </Field>
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
      <button
        type="button"
        className={btn.primary + ' self-start'}
        disabled={busy}
        onClick={() => void save()}
      >
        Save
      </button>
    </Section>
  );
}
