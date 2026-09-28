'use client';

import { useState } from 'react';
import { linkStaff, loadLocationHours } from '@/lib/biz/data';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Field, Notice, btn, codeOf, input } from './ui';

/**
 * "I also take appointments" / "I work alone — add myself" (Phase 2 B1 step 6, B9 empty state).
 * The staff profile uses the person's real name: if their profile has none yet, ask for it (and
 * save it to their profile, so bookings and the team list show it too).
 */
export function AddMyself({
  businessId,
  locationId,
  serviceIds,
  label,
  onDone,
}: {
  businessId: string;
  locationId: string;
  serviceIds: string[];
  label: string;
  onDone: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (displayName: string) => {
    const { data: id, error: err } = await supabase().rpc('create_my_staff_profile', {
      p_business_id: businessId,
      p_display_name: displayName,
    });
    if (err || !id) throw err ?? new Error('NOT_FOUND');
    await linkStaff(businessId, locationId, id, serviceIds, await loadLocationHours(locationId));
    await onDone();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const { data: me } = await supabase().rpc('get_my_access');
      const name = ((me as { first_name?: string | null } | null)?.first_name ?? '').trim();
      if (!name) {
        setAsking(true);
        return;
      }
      await create(name);
    });

  const saveName = () =>
    run(async () => {
      const f = first.trim();
      const l = last.trim();
      if (!f) throw { message: 'NAME_REQUIRED' };
      const { data: s } = await supabase().auth.getSession();
      const { error: err } = await supabase()
        .from('profiles')
        .update({ first_name: f.slice(0, 50), last_name: l ? l.slice(0, 50) : null })
        .eq('id', s.session!.user.id);
      if (err) throw err;
      await create(l ? `${f} ${l}` : f);
      setAsking(false);
    });

  if (asking) {
    return (
      <div
        className="flex flex-col gap-3 rounded-control bg-surface-50 p-3"
        data-testid="ask-my-name"
      >
        <p className="text-sm font-medium">
          What&apos;s your name? Customers will see it when they book with you.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <input
              className={input}
              value={first}
              maxLength={50}
              autoFocus
              onChange={(e) => setFirst(e.target.value)}
            />
          </Field>
          <Field label="Last name (optional)">
            <input
              className={input}
              value={last}
              maxLength={50}
              onChange={(e) => setLast(e.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <Notice tone="danger">
            {error === describeError('NAME_REQUIRED') ? 'Enter your first name.' : error}
          </Notice>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            className={btn.primary}
            disabled={busy || !first.trim()}
            onClick={() => void saveName()}
          >
            Add me to the team
          </button>
          <button type="button" className={btn.link} onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button type="button" className={btn.secondary} disabled={busy} onClick={() => void start()}>
        {label}
      </button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </>
  );
}
