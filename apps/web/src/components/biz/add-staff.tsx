'use client';

import { useEffect, useState } from 'react';
import { HoursGrid } from '@/components/biz/hours-grid';
import { Field, Notice, Section, Toggle, btn, codeOf, input } from '@/components/biz/ui';
import { createStaff, loadLocationHours, type Service } from '@/lib/biz/data';
import { defaultWeek, weekErrors, type WeekHours } from '@/lib/biz/time';
import { describeError } from '@/lib/copy';

/** "+ Add team member" (B9 / B1 step 6): hours default to the business hours. */
export function AddStaff({
  businessId,
  locationId,
  services,
  onDone,
  onCancel,
}: {
  businessId: string;
  locationId: string;
  services: Service[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [autoAssign, setAutoAssign] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>(services.map((s) => s.id));
  const [week, setWeek] = useState<WeekHours>(defaultWeek());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // default = business hours (Phase 2 B1 step 6)
    void loadLocationHours(locationId).then((w) => {
      if (Object.values(w).some((d) => d.length)) setWeek(w);
    });
  }, [locationId]);

  const save = async () => {
    if (!name.trim()) return setError('Enter a name.');
    if (Object.keys(weekErrors(week)).length) return setError('Fix the hours first.');
    setBusy(true);
    setError(null);
    try {
      await createStaff(
        businessId,
        locationId,
        {
          display_name: name.trim(),
          role_title: title.trim() || null,
          publicly_bookable: isPublic,
          accepts_any_assignment: isPublic && autoAssign,
        },
        serviceIds,
        week,
      );
      await onDone();
    } catch (e) {
      setError(describeError(codeOf(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="New team member">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className={input}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Role / title (optional)">
          <input
            className={input}
            value={title}
            placeholder="Senior stylist"
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
      </div>
      <Toggle
        label="Publicly bookable"
        description="Customers can see and choose this person online. Off = internal only (still in your calendar)."
        checked={isPublic}
        onChange={(v) => {
          setIsPublic(v);
          if (!v) setAutoAssign(false);
        }}
      />
      <Toggle
        label="Accept automatic assignment"
        description={'Can be assigned when a customer picks "Any available".'}
        checked={autoAssign}
        disabled={!isPublic}
        onChange={setAutoAssign}
      />
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Services</legend>
        {services.map((s) => (
          <label key={s.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={serviceIds.includes(s.id)}
              onChange={(e) =>
                setServiceIds((ids) =>
                  e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                )
              }
            />
            {s.name}
          </label>
        ))}
        {services.length === 0 ? (
          <span className="text-ink-500">No services yet; assign them later.</span>
        ) : null}
      </fieldset>
      <div>
        <p className="mb-2 text-sm font-medium">Working hours</p>
        <HoursGrid value={week} onChange={setWeek} closedLabel="Day off" />
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
          Add team member
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Section>
  );
}
