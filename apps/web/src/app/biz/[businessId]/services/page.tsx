'use client';

import { useMemo, useState } from 'react';
import { ServiceForm, type ServiceFormValue } from '@/components/biz/service-form';
import { ServiceTemplatePicker } from '@/components/biz/service-templates';
import { Body, Notice, PageHeader, Section, btn, codeOf } from '@/components/biz/ui';
import { canManage, useBiz } from '@/lib/biz/context';
import {
  addTemplateServices,
  loadCatalog,
  loadServices,
  loadStaff,
  priceLabel,
  saveService,
  setServiceStatus,
  suggestCatalogEntry,
  type Canonical,
  type Service,
  type Staff,
} from '@/lib/biz/data';
import { describeError } from '@/lib/copy';
import { useLoad } from '@/lib/biz/use-load';
import { supabase } from '@/lib/supabase';

// B8 Services
export default function ServicesPage() {
  const { business, role } = useBiz();
  const { data, reload } = useLoad(
    () => Promise.all([loadServices(business.id), loadStaff(business.id), loadCatalog()]),
    [business.id],
  );
  const services: Service[] | null = data?.[0] ?? null;
  const staff: Staff[] = data?.[1] ?? [];
  const canonical: Canonical[] = useMemo(() => data?.[2] ?? [], [data]);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Templates come from the business's own category; the editor searches the whole catalog
  const templates = useMemo(
    () => canonical.filter((c) => c.category_id === business.primary_category_id),
    [canonical, business.primary_category_id],
  );
  const otherId = canonical.find((c) => c.slug.startsWith('other-'))?.id ?? null;
  const activeStaffIds = staff.filter((s) => s.status === 'active').map((s) => s.id);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  const save = (v: ServiceFormValue) =>
    run(async () => {
      const id = await saveService(
        business.id,
        v.input,
        v.staffIds,
        editing && editing !== 'new' ? editing.id : undefined,
      );
      if (id && v.otherName) await suggestCatalogEntry(business.id, id, v.otherName);
      setEditing(null);
    });

  if (!canManage(role)) {
    return (
      <>
        <PageHeader title="Services" />
        <Body>
          <Notice>Only owners and managers can change services.</Notice>
        </Body>
      </>
    );
  }

  const active = (services ?? []).filter((s) => s.status === 'active');
  const archived = (services ?? []).filter((s) => s.status === 'archived');

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="The menu customers book from."
        actions={
          <>
            <button
              type="button"
              className={btn.secondary}
              onClick={() => setShowTemplates((v) => !v)}
            >
              Common services
            </button>
            <button type="button" className={btn.primary} onClick={() => setEditing('new')}>
              + Add service
            </button>
          </>
        }
      />
      <Body>
        {error ? <Notice tone="danger">{error}</Notice> : null}

        {editing ? (
          <Section title={editing === 'new' ? 'New service' : `Edit ${editing.name}`}>
            <ServiceForm
              key={editing === 'new' ? 'new' : editing.id}
              canonical={canonical}
              otherId={otherId}
              staff={staff}
              initial={editing === 'new' ? undefined : editing}
              busy={busy}
              onSubmit={(v) => void save(v)}
              onCancel={() => setEditing(null)}
            />
          </Section>
        ) : null}

        {showTemplates || (services && active.length === 0 && !editing) ? (
          <Section
            title="Start from common services"
            description="Check what you offer and enter prices. You can edit everything later."
          >
            <ServiceTemplatePicker
              canonical={templates.length ? templates : canonical}
              existingCanonicalIds={active.map((s) => s.canonical_service_id)}
              busy={busy}
              onCreate={(picks) =>
                void run(() => addTemplateServices(business.id, picks, activeStaffIds)).then(() =>
                  setShowTemplates(false),
                )
              }
            />
          </Section>
        ) : null}

        {active.length > 0 ? (
          <ul
            className="flex flex-col divide-y divide-line-200 rounded-card border border-line-200 bg-surface-0"
            data-testid="service-list"
          >
            {active.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <div className="min-w-40 flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-ink-500">
                    {s.duration_min} min · {priceLabel(s)} · {s.staff_ids.length} staff
                    {s.staff_ids.length === 0 && s.is_online_bookable ? (
                      <span className="text-warning-600"> · no one performs it</span>
                    ) : null}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-ink-700">
                  <input
                    type="checkbox"
                    checked={s.is_online_bookable}
                    disabled={busy || s.price_type === 'on_consultation'}
                    aria-label={`${s.name} bookable online`}
                    onChange={(e) =>
                      void run(async () => {
                        const { error: err } = await supabase()
                          .from('services')
                          .update({ is_online_bookable: e.target.checked })
                          .eq('id', s.id);
                        if (err) throw err;
                      })
                    }
                  />
                  Online
                </label>
                <button type="button" className={btn.link} onClick={() => setEditing(s)}>
                  Edit
                </button>
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy}
                  onClick={() => void run(() => setServiceStatus(s.id, 'archived'))}
                >
                  Archive
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {archived.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-500">Archived ({archived.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {archived.map((s) => (
                <li key={s.id} className="flex items-center justify-between">
                  <span>{s.name}</span>
                  <button
                    type="button"
                    className={btn.link}
                    onClick={() => void run(() => setServiceStatus(s.id, 'active'))}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Body>
    </>
  );
}
