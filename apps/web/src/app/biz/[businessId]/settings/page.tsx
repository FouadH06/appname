'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BasicsSection } from '@/components/biz/sections/basics';
import { DangerSection } from '@/components/biz/sections/danger';
import { ClosuresSection, HoursSection } from '@/components/biz/sections/hours';
import { LocationSection } from '@/components/biz/sections/location';
import { PhotosSection } from '@/components/biz/sections/photos';
import { RulesSection } from '@/components/biz/sections/rules';
import { ShareSection } from '@/components/biz/sections/share';
import { TeamSection } from '@/components/biz/sections/team';
import { Body, Notice, PageHeader } from '@/components/biz/ui';
import { canManage, useBiz } from '@/lib/biz/context';

const SECTIONS = [
  { key: 'profile', label: 'Business profile' },
  { key: 'photos', label: 'Photos' },
  { key: 'location', label: 'Location & hours' },
  { key: 'rules', label: 'Booking rules' },
  { key: 'team', label: 'Team & roles' },
  { key: 'share', label: 'Booking link & kit' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'danger', label: 'Danger zone' },
] as const;

// B12 Settings: section list → section page
function Settings() {
  const { business, role } = useBiz();
  const params = useSearchParams();
  const section = params.get('section') ?? 'profile';
  const base = `/biz/${business.id}/settings`;
  const visible = SECTIONS.filter((s) => s.key !== 'danger' || role === 'owner');

  if (!canManage(role)) {
    return (
      <>
        <PageHeader title="Settings" />
        <Body>
          <Notice>Only owners and managers can change settings.</Notice>
        </Body>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:flex-row md:p-6">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col"
          aria-label="Settings sections"
        >
          {visible.map((s) => (
            <Link
              key={s.key}
              href={`${base}?section=${s.key}`}
              aria-current={section === s.key ? 'page' : undefined}
              className="whitespace-nowrap rounded-control px-3 py-2 text-sm text-ink-700 hover:bg-surface-100 aria-[current=page]:bg-surface-0 aria-[current=page]:font-semibold aria-[current=page]:text-ink-900"
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {section === 'profile' ? <BasicsSection /> : null}
          {section === 'photos' ? <PhotosSection /> : null}
          {section === 'location' ? (
            <>
              <LocationSection />
              <HoursSection />
              <ClosuresSection />
            </>
          ) : null}
          {section === 'rules' ? <RulesSection /> : null}
          {section === 'team' ? <TeamSection /> : null}
          {section === 'share' ? <ShareSection /> : null}
          {section === 'notifications' ? (
            <Notice>
              Choosing who gets WhatsApp/push alerts for new bookings, cancellations and reviews
              arrives with notifications (M7).
            </Notice>
          ) : null}
          {section === 'danger' ? <DangerSection /> : null}
        </div>
      </div>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
