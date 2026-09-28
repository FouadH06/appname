'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AddStaff } from '@/components/biz/add-staff';
import { Body, Notice, PageHeader, Section, btn, codeOf } from '@/components/biz/ui';
import { canManage, useBiz } from '@/lib/biz/context';
import {
  linkStaff,
  loadLocationHours,
  loadServices,
  loadStaff,
  type Service,
  type Staff,
} from '@/lib/biz/data';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

// B9 Staff — list and "+ Add team member"
export default function StaffPage() {
  const { business, location, role } = useBiz();
  const { data, reload } = useLoad(
    () => Promise.all([loadStaff(business.id), loadServices(business.id)]),
    [business.id],
  );
  const staff: Staff[] | null = data?.[0] ?? null;
  const services: Service[] = (data?.[1] ?? []).filter((s) => s.status === 'active');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addMyself = async () => {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const { data: me } = await supabase().rpc('get_my_access');
      const name = ((me as { first_name?: string } | null)?.first_name ?? '').trim() || 'Me';
      const { data: id, error: err } = await supabase().rpc('create_my_staff_profile', {
        p_business_id: business.id,
        p_display_name: name,
      });
      if (err || !id) throw err;
      await linkStaff(
        business.id,
        location.id,
        id,
        services.map((s) => s.id),
        await loadLocationHours(location.id),
      );
      await reload();
    } catch (e) {
      setError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  const manage = canManage(role);
  const active = (staff ?? []).filter((s) => s.status === 'active');
  const archived = (staff ?? []).filter((s) => s.status === 'archived');

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Profiles, services, schedules and access."
        actions={
          manage ? (
            <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
              + Add team member
            </button>
          ) : null
        }
      />
      <Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {adding && location ? (
          <AddStaff
            businessId={business.id}
            locationId={location.id}
            services={services}
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        {staff && active.length === 0 && !adding ? (
          <Section title="Add your team so customers can pick who they book with">
            {manage ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
                  + Add team member
                </button>
                <button
                  type="button"
                  className={btn.secondary}
                  disabled={busy}
                  onClick={() => void addMyself()}
                >
                  I work alone — add myself
                </button>
              </div>
            ) : null}
          </Section>
        ) : null}

        {active.length > 0 ? (
          <ul
            className="flex flex-col divide-y divide-line-200 rounded-card border border-line-200 bg-surface-0"
            data-testid="staff-list"
          >
            {active.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/biz/${business.id}/staff/${s.id}`}
                  className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-surface-50"
                >
                  <span className="grid size-9 place-items-center rounded-full bg-surface-100 font-semibold">
                    {s.display_name.slice(0, 1)}
                  </span>
                  <span className="min-w-40 flex-1">
                    <span className="block font-medium">{s.display_name}</span>
                    <span className="text-ink-500">{s.role_title ?? 'Team member'}</span>
                  </span>
                  <span className="text-ink-500">
                    {s.publicly_bookable
                      ? s.accepts_any_assignment
                        ? 'Public · auto-assign'
                        : 'Public · chosen only'
                      : 'Internal only'}
                  </span>
                  {s.user_id ? <span className="text-xs text-success-600">Has login</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}

        {archived.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-500">
              Former team members ({archived.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((s) => (
                <li key={s.id}>
                  <Link className={btn.link} href={`/biz/${business.id}/staff/${s.id}`}>
                    {s.display_name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Body>
    </>
  );
}
