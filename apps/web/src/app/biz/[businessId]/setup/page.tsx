'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AddStaff } from '@/components/biz/add-staff';
import { BasicsSection } from '@/components/biz/sections/basics';
import { HoursSection } from '@/components/biz/sections/hours';
import { LocationSection } from '@/components/biz/sections/location';
import { PhotosSection } from '@/components/biz/sections/photos';
import { RulesSection } from '@/components/biz/sections/rules';
import { ShareSection } from '@/components/biz/sections/share';
import { ServiceTemplatePicker } from '@/components/biz/service-templates';
import { Notice, PageHeader, Section, btn, codeOf } from '@/components/biz/ui';
import { CHECKLIST_COPY, type ChecklistItem } from '@/lib/biz/checklist';
import { canManage, useBiz } from '@/lib/biz/context';
import {
  addTemplateServices,
  linkStaff,
  loadCatalog,
  loadLocationHours,
  loadServices,
  loadStaff,
  priceLabel,
} from '@/lib/biz/data';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

const STEPS = [
  { key: 'basics', label: 'Basics' },
  { key: 'location', label: 'Location' },
  { key: 'hours', label: 'Hours' },
  { key: 'services', label: 'Services' },
  { key: 'team', label: 'Team' },
  { key: 'photos', label: 'Photos' },
  { key: 'rules', label: 'Booking rules' },
  { key: 'golive', label: 'Preview & go live' },
  { key: 'share', label: 'Share kit' },
] as const;
type StepKey = (typeof STEPS)[number]['key'];

// B1 Onboarding (assisted and owner modes). Every step saves as you go; "Continue" moves on.
function Setup() {
  const { business, role } = useBiz();
  const router = useRouter();
  const params = useSearchParams();
  const step = (STEPS.find((s) => s.key === params.get('step'))?.key ?? 'basics') as StepKey;
  const idx = STEPS.findIndex((s) => s.key === step);
  const base = `/biz/${business.id}/setup`;
  const go = (k: StepKey) => router.push(`${base}?step=${k}`);
  const next = () => {
    const n = STEPS[idx + 1];
    if (n) go(n.key);
  };

  if (!canManage(role)) return <Notice>Only owners and managers can set up the business.</Notice>;

  return (
    <>
      <PageHeader
        title="Set up your business"
        subtitle={`Step ${idx + 1} of ${STEPS.length} · ${STEPS[idx]!.label}`}
      />
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 md:flex-row md:p-6">
        <ol
          className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col"
          aria-label="Setup steps"
          data-testid="wizard-steps"
        >
          {STEPS.map((s, i) => (
            <li key={s.key}>
              <Link
                href={`${base}?step=${s.key}`}
                aria-current={s.key === step ? 'step' : undefined}
                className="flex items-center gap-2 whitespace-nowrap rounded-control px-3 py-2 text-sm text-ink-700 hover:bg-surface-100 aria-[current=step]:bg-surface-0 aria-[current=step]:font-semibold aria-[current=step]:text-ink-900"
              >
                <span className="grid size-5 place-items-center rounded-full bg-surface-100 text-xs">
                  {i + 1}
                </span>
                {s.label}
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {step === 'basics' ? <BasicsSection /> : null}
          {step === 'location' ? <LocationSection /> : null}
          {step === 'hours' ? <HoursSection /> : null}
          {step === 'services' ? <ServicesStep /> : null}
          {step === 'team' ? <TeamStep /> : null}
          {step === 'photos' ? <PhotosSection /> : null}
          {step === 'rules' ? <RulesSection compact /> : null}
          {step === 'golive' ? <GoLiveStep onJump={go} onLive={() => go('share')} /> : null}
          {step === 'share' ? (
            <>
              <ShareSection />
              <Link href={`/biz/${business.id}`} className={btn.primary + ' self-start'}>
                Done
              </Link>
            </>
          ) : null}
          {step !== 'golive' && step !== 'share' ? (
            <div className="flex gap-2">
              <button
                type="button"
                className={btn.primary}
                onClick={next}
                data-testid="wizard-continue"
              >
                Continue
              </button>
              <Link href={`/biz/${business.id}`} className={btn.secondary}>
                Save & exit
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ServicesStep() {
  const { business } = useBiz();
  const { data, reload } = useLoad(
    () => Promise.all([loadServices(business.id), loadStaff(business.id), loadCatalog()]),
    [business.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-ink-500">Loading…</p>;
  const [services, staff, catalog] = data;
  const active = services.filter((s) => s.status === 'active');
  const templates = catalog.filter((c) => c.category_id === business.primary_category_id);
  return (
    <>
      <Section
        title="Services"
        description="Start from common services: check what you offer and enter prices. Target: about 3 minutes."
      >
        <ServiceTemplatePicker
          canonical={templates.length ? templates : catalog}
          existingCanonicalIds={active.map((s) => s.canonical_service_id)}
          busy={busy}
          onCreate={(picks) =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                await addTemplateServices(
                  business.id,
                  picks,
                  staff.filter((s) => s.status === 'active').map((s) => s.id),
                );
                await reload();
              } catch (e) {
                setError(describeError(codeOf(e)));
              } finally {
                setBusy(false);
              }
            })()
          }
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>
      {active.length ? (
        <Section title={`Your services (${active.length})`}>
          <ul className="text-sm" data-testid="wizard-services">
            {active.map((s) => (
              <li key={s.id} className="flex justify-between py-1">
                <span>{s.name}</span>
                <span className="text-ink-500">
                  {s.duration_min} min · {priceLabel(s)}
                </span>
              </li>
            ))}
          </ul>
          <Link href={`/biz/${business.id}/services`} className={btn.link}>
            Edit names, prices, buffers or add custom services →
          </Link>
        </Section>
      ) : null}
    </>
  );
}

function TeamStep() {
  const { business, location } = useBiz();
  const { data, reload } = useLoad(
    () => Promise.all([loadStaff(business.id), loadServices(business.id)]),
    [business.id],
  );
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || !location) return <p className="text-sm text-ink-500">Loading…</p>;
  const [staff, services] = data;
  const active = staff.filter((s) => s.status === 'active');
  const activeServices = services.filter((s) => s.status === 'active');

  const addMyself = async () => {
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
        activeServices.map((s) => s.id),
        await loadLocationHours(location.id),
      );
      await reload();
    } catch (e) {
      setError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Team"
        description="Who takes appointments. Hours default to the business hours; services default to all."
      >
        <ul className="text-sm" data-testid="wizard-team">
          {active.map((s) => (
            <li key={s.id} className="flex justify-between py-1">
              <span>{s.display_name}</span>
              <span className="text-ink-500">
                {s.publicly_bookable ? 'Public' : 'Internal only'}
              </span>
            </li>
          ))}
          {active.length === 0 ? <li className="text-ink-500">No one yet.</li> : null}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} onClick={() => setAdding(true)}>
            + Add team member
          </button>
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() => void addMyself()}
          >
            I also take appointments
          </button>
        </div>
        {error ? <Notice tone="danger">{error}</Notice> : null}
      </Section>
      {adding ? (
        <AddStaff
          businessId={business.id}
          locationId={location.id}
          services={activeServices}
          onDone={async () => {
            setAdding(false);
            await reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}

function GoLiveStep({ onJump, onLive }: { onJump: (k: StepKey) => void; onLive: () => void }) {
  const { business, refresh } = useBiz();
  const { data, reload } = useLoad(async () => {
    const [list, services, staff] = await Promise.all([
      supabase().rpc('get_go_live_checklist', { p_business_id: business.id }),
      loadServices(business.id),
      loadStaff(business.id),
    ]);
    return {
      checklist: (list.data ?? []) as unknown as ChecklistItem[],
      services: services.filter((s) => s.status === 'active' && s.is_online_bookable),
      staff: staff.filter((s) => s.status === 'active' && s.publicly_bookable),
    };
  }, [business.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-ink-500">Loading…</p>;
  const ready = data.checklist.every((i) => i.ok);
  const live = business.status === 'live';

  const publish = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase().rpc('publish_business', { p_business_id: business.id });
    setBusy(false);
    if (err) {
      setError(
        codeOf(err) === 'GO_LIVE_BLOCKED'
          ? 'Some items are still missing.'
          : describeError(codeOf(err)),
      );
      await reload();
      return;
    }
    await refresh();
    onLive();
  };

  return (
    <>
      <Section title="Go-live checklist">
        <ul className="flex flex-col gap-2" data-testid="golive-checklist">
          {data.checklist.map((i) => (
            <li key={i.key} className="flex items-center justify-between text-sm">
              <span>
                <span aria-hidden className={i.ok ? 'text-success-600' : 'text-danger-600'}>
                  {i.ok ? '✓' : '✗'}
                </span>{' '}
                {CHECKLIST_COPY[i.key].label}
              </span>
              {!i.ok ? (
                <button
                  type="button"
                  className={btn.link}
                  onClick={() => onJump(CHECKLIST_COPY[i.key].step as StepKey)}
                >
                  Fix
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section
        title="Preview"
        description="Roughly what customers will see. The full public page arrives with customer booking (M8)."
      >
        <div
          className="mx-auto w-full max-w-xs rounded-[28px] border-8 border-ink-900 bg-surface-0 p-4 text-sm"
          data-testid="phone-preview"
        >
          <p className="text-lg font-semibold">{business.name}</p>
          <p className="text-ink-500">{business.description?.slice(0, 120)}</p>
          <p className="mt-3 font-medium">Services</p>
          <ul>
            {data.services.slice(0, 6).map((s) => (
              <li key={s.id} className="flex justify-between py-0.5">
                <span>{s.name}</span>
                <span>{priceLabel(s)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 font-medium">Team</p>
          <p className="text-ink-700">{data.staff.map((s) => s.display_name).join(' · ') || '—'}</p>
          <p className="mt-3 rounded-control bg-accent-600 py-2 text-center font-semibold text-white">
            Book
          </p>
        </div>
      </Section>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {live ? (
        <Notice tone="success">You&apos;re live. Customers can book you online.</Notice>
      ) : (
        <button
          type="button"
          className={btn.primary + ' self-start'}
          disabled={!ready || busy}
          onClick={() => void publish()}
          data-testid="go-live"
        >
          Go live
        </button>
      )}
    </>
  );
}

export default function SetupPage() {
  return (
    <Suspense>
      <Setup />
    </Suspense>
  );
}
