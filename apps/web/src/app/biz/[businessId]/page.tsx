'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Body, Notice, PageHeader, Section, btn } from '@/components/biz/ui';
import { canManage, useBiz } from '@/lib/biz/context';
import { CHECKLIST_COPY, type ChecklistItem } from '@/lib/biz/checklist';
import { supabase } from '@/lib/supabase';

// B2 Overview (lean). The "Today" agenda arrives with the calendar in M6.
export default function OverviewPage() {
  const { business, role, settings } = useBiz();
  const [checklist, setChecklist] = useState<ChecklistItem[] | null>(null);
  const base = `/biz/${business.id}`;

  useEffect(() => {
    if (business.status !== 'draft') return;
    void supabase()
      .rpc('get_go_live_checklist', { p_business_id: business.id })
      .then(({ data }) => setChecklist((data as unknown as ChecklistItem[]) ?? []));
  }, [business.id, business.status]);

  return (
    <>
      <PageHeader title={role === 'staff' ? 'Today' : 'Overview'} subtitle={business.name} />
      <Body>
        {business.status === 'draft' ? (
          <Section
            title="Get ready to go live"
            description="Complete these, then publish your booking page."
          >
            <ul className="flex flex-col gap-2" data-testid="overview-checklist">
              {(checklist ?? []).map((i) => (
                <li key={i.key} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span aria-hidden className={i.ok ? 'text-success-600' : 'text-ink-500'}>
                      {i.ok ? '✓' : '○'}
                    </span>{' '}
                    {CHECKLIST_COPY[i.key].label}
                  </span>
                  {!i.ok && canManage(role) ? (
                    <Link
                      className={btn.link}
                      href={`${base}/setup?step=${CHECKLIST_COPY[i.key].step}`}
                    >
                      Fix
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
            {canManage(role) ? (
              <Link href={`${base}/setup`} className={btn.primary + ' self-start'}>
                Continue setup
              </Link>
            ) : null}
          </Section>
        ) : null}

        {business.status === 'live' ? (
          <Section
            title="Your booking link"
            description="Share it on Instagram, WhatsApp and your counter."
          >
            <p className="font-mono text-sm" data-testid="booking-link">
              platform.com/{business.slug}
            </p>
            {settings && !settings.allow_online_booking ? (
              <Notice tone="warning">
                Online booking is paused. Customers can still see your profile and contact you.
              </Notice>
            ) : null}
            {canManage(role) ? (
              <Link
                href={`${base}/settings?section=share`}
                className={btn.secondary + ' self-start'}
              >
                Share kit
              </Link>
            ) : null}
          </Section>
        ) : null}

        <Notice>
          The day&apos;s agenda (appointments, requests, walk-ins) arrives with the calendar in M6.
        </Notice>
      </Body>
    </>
  );
}
