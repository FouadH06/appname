'use client';

import { useMemo, useState } from 'react';
import type { Enums } from '@app/db';
import type { Canonical, Service, ServiceInput, Staff } from '@/lib/biz/data';
import { Field, Toggle, btn, input } from './ui';

export interface ServiceFormValue {
  input: ServiceInput;
  staffIds: string[];
  /** Name for a catalog suggestion when "Other" is picked */
  otherName: string | null;
}

const PRICE_TYPES: { value: Enums<'price_type'>; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'from', label: 'From' },
  { value: 'range', label: 'Range' },
  { value: 'on_consultation', label: 'On consultation' },
];

/**
 * B8 service editor. Mapping to a canonical service is required ("helps customers find you");
 * "Other" maps to the category fallback and files a catalog suggestion for ops to review.
 */
export function ServiceForm({
  canonical,
  otherId,
  staff,
  initial,
  onSubmit,
  onCancel,
  busy,
}: {
  canonical: Canonical[];
  otherId: string | null;
  staff: Staff[];
  initial?: Service;
  onSubmit: (v: ServiceFormValue) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [canonId, setCanonId] = useState(initial?.canonical_service_id ?? '');
  const [query, setQuery] = useState(initial?.canonical_name ?? '');
  const [otherName, setOtherName] = useState('');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [priceType, setPriceType] = useState<Enums<'price_type'>>(initial?.price_type ?? 'fixed');
  const [priceMin, setPriceMin] = useState(initial?.price_min?.toString() ?? '');
  const [priceMax, setPriceMax] = useState(initial?.price_max?.toString() ?? '');
  const [duration, setDuration] = useState(initial?.duration_min ?? 30);
  const [bufBefore, setBufBefore] = useState(initial?.buffer_before_min ?? 0);
  const [bufAfter, setBufAfter] = useState(initial?.buffer_after_min ?? 0);
  const [audience, setAudience] = useState<Enums<'audience'>>(initial?.audience ?? 'everyone');
  const [online, setOnline] = useState(initial?.is_online_bookable ?? true);
  const [staffIds, setStaffIds] = useState<string[]>(
    initial?.staff_ids ?? staff.filter((s) => s.status === 'active').map((s) => s.id),
  );
  const [error, setError] = useState<string | null>(null);

  const isOther = canonId !== '' && canonId === otherId;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return canonical
      .filter((c) => c.id !== otherId && (!q || c.name_en.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [canonical, otherId, query]);

  const submit = () => {
    if (!canonId) return setError('Pick what service this is (it helps customers find you).');
    if (isOther && !otherName.trim())
      return setError('Tell us what the service is called so we can add it.');
    if (!name.trim()) return setError('Enter a name.');
    const min = priceMin === '' ? null : Number(priceMin);
    const max = priceMax === '' ? null : Number(priceMax);
    if (priceType !== 'on_consultation' && (min === null || Number.isNaN(min) || min < 0))
      return setError('Enter a price.');
    if (priceType === 'range' && (max === null || Number.isNaN(max) || max <= (min ?? 0)))
      return setError('The range needs a higher maximum.');
    if (duration < 5 || duration > 720)
      return setError('Duration must be between 5 minutes and 12 hours.');
    setError(null);
    onSubmit({
      input: {
        canonical_service_id: canonId,
        name: name.trim(),
        description: description.trim() || null,
        price_type: priceType,
        price_min: priceType === 'on_consultation' ? null : min,
        price_max: priceType === 'range' ? max : null,
        duration_min: duration,
        buffer_before_min: bufBefore,
        buffer_after_min: bufAfter,
        audience,
        is_online_bookable: priceType === 'on_consultation' ? false : online,
      },
      staffIds,
      otherName: isOther ? otherName.trim() : null,
    });
  };

  const activeStaff = staff.filter((s) => s.status === 'active');

  return (
    <div className="flex flex-col gap-4" data-testid="service-form">
      <Field label="What service is this?" hint="Helps customers find you in search.">
        <input
          className={input}
          value={query}
          placeholder="e.g. Balayage, Men's haircut"
          onChange={(e) => {
            setQuery(e.target.value);
            setCanonId('');
          }}
          aria-label="Search the service catalog"
        />
      </Field>
      {!canonId ? (
        <ul className="-mt-2 flex flex-wrap gap-2" aria-label="Catalog matches">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={btn.secondary + ' h-8'}
                onClick={() => {
                  setCanonId(c.id);
                  setQuery(c.name_en);
                  if (!name) setName(c.name_en);
                  if (!initial && c.typical_duration_min) setDuration(c.typical_duration_min);
                }}
              >
                {c.name_en}
              </button>
            </li>
          ))}
          {otherId ? (
            <li>
              <button
                type="button"
                className={btn.link + ' h-8'}
                onClick={() => {
                  setCanonId(otherId);
                  setOtherName(query);
                  if (!name) setName(query);
                }}
              >
                Can&apos;t find it? Choose “Other”
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      {isOther ? (
        <Field
          label="What is it called?"
          hint="We'll review it and add it to the catalog. It's bookable meanwhile."
        >
          <input
            className={input}
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
          />
        </Field>
      ) : null}

      <Field label="Name customers see">
        <input
          className={input}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description (optional)">
        <textarea
          className={input + ' h-20 py-2'}
          value={description}
          maxLength={600}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Price">
          <select
            className={input}
            value={priceType}
            onChange={(e) => {
              const v = e.target.value as Enums<'price_type'>;
              setPriceType(v);
              if (v === 'on_consultation') setOnline(false);
            }}
          >
            {PRICE_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        {priceType !== 'on_consultation' ? (
          <Field label={priceType === 'range' ? 'From ($)' : 'Amount ($)'}>
            <input
              className={input}
              inputMode="decimal"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
            />
          </Field>
        ) : null}
        {priceType === 'range' ? (
          <Field label="To ($)">
            <input
              className={input}
              inputMode="decimal"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
            />
          </Field>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Duration (min)">
          <input
            className={input}
            type="number"
            min={5}
            max={720}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
        <Field label="Buffer before (min)" hint="Prep time">
          <input
            className={input}
            type="number"
            min={0}
            max={120}
            step={5}
            value={bufBefore}
            onChange={(e) => setBufBefore(Number(e.target.value))}
          />
        </Field>
        <Field label="Buffer after (min)" hint="Clean-up time">
          <input
            className={input}
            type="number"
            min={0}
            max={120}
            step={5}
            value={bufAfter}
            onChange={(e) => setBufAfter(Number(e.target.value))}
          />
        </Field>
      </div>

      <Field label="For">
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

      <Toggle
        label="Bookable online"
        description={
          priceType === 'on_consultation'
            ? 'On-consultation services are booked by the business.'
            : undefined
        }
        checked={online}
        disabled={priceType === 'on_consultation'}
        onChange={setOnline}
      />

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Who performs it</legend>
        {activeStaff.length === 0 ? (
          <span className="text-ink-500">Add your team first; you can assign it later.</span>
        ) : null}
        {activeStaff.map((s) => (
          <label key={s.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={staffIds.includes(s.id)}
              onChange={(e) =>
                setStaffIds((ids) =>
                  e.target.checked ? [...ids, s.id] : ids.filter((x) => x !== s.id),
                )
              }
            />
            {s.display_name}
          </label>
        ))}
        {online && activeStaff.length > 0 && staffIds.length === 0 ? (
          <span className="text-warning-600">
            Customers won&apos;t see times for this service until someone performs it.
          </span>
        ) : null}
      </fieldset>

      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button type="button" className={btn.primary} disabled={busy} onClick={submit}>
          Save service
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
