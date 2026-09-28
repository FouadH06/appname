'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { parsePhone } from '@app/core';
import { useBiz } from '@/lib/biz/context';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Field, Notice, Section, btn, codeOf, input } from '../ui';

const MapPin = dynamic(() => import('../map-pin').then((m) => m.MapPin), { ssr: false });

interface Pin {
  lat: number;
  lng: number;
}

async function loadLocation(locationId: string) {
  const c = supabase();
  const [pin, areas] = await Promise.all([
    // lat/lng are computed columns (public.lat/lng on business_locations)
    c
      .from('business_locations')
      .select(
        'area_id, address_line, building, floor, landmark, phone_e164, whatsapp_e164, lat, lng' as '*',
      )
      .eq('id', locationId)
      .single(),
    c
      .from('areas')
      .select('id, name_en, is_live')
      .eq('level', 'area')
      .order('is_live', { ascending: false })
      .order('name_en'),
  ]);
  return {
    loc: pin.data as unknown as {
      area_id: string;
      address_line: string | null;
      building: string | null;
      floor: string | null;
      landmark: string | null;
      phone_e164: string | null;
      whatsapp_e164: string | null;
      lat: number;
      lng: number;
    } | null,
    areas: areas.data ?? [],
  };
}

export function LocationSection({ onSaved }: { onSaved?: () => void }) {
  const { location, refresh } = useBiz();
  const { data } = useLoad(
    () => (location ? loadLocation(location.id) : Promise.resolve(null)),
    [location?.id],
  );
  if (!location)
    return <Notice tone="warning">No location yet. Ops creates it with the business.</Notice>;
  if (!data?.loc) return <p className="text-sm text-ink-500">Loading…</p>;
  return (
    <LocationForm
      key={location.id}
      locationId={location.id}
      initial={data.loc}
      areas={data.areas}
      onSaved={async () => {
        await refresh();
        onSaved?.();
      }}
    />
  );
}

function LocationForm({
  locationId,
  initial,
  areas,
  onSaved,
}: {
  locationId: string;
  initial: NonNullable<Awaited<ReturnType<typeof loadLocation>>['loc']>;
  areas: { id: string; name_en: string; is_live: boolean }[];
  onSaved: () => Promise<void>;
}) {
  const [areaId, setAreaId] = useState(initial.area_id);
  const [address, setAddress] = useState(initial.address_line ?? '');
  const [building, setBuilding] = useState(initial.building ?? '');
  const [floor, setFloor] = useState(initial.floor ?? '');
  const [landmark, setLandmark] = useState(initial.landmark ?? '');
  const [phone, setPhone] = useState(initial.phone_e164 ?? '');
  const [whatsapp, setWhatsapp] = useState(initial.whatsapp_e164 ?? '');
  const [pin, setPin] = useState<Pin>({ lat: initial.lat, lng: initial.lng });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const phoneOf = (raw: string, label: string) => {
    if (!raw.trim()) return null;
    const p = parsePhone(raw);
    if (!p.ok) throw new Error(`${label}: check the number`);
    return p.phone.e164;
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (pin.lat < 33 || pin.lat > 34.8 || pin.lng < 35 || pin.lng > 36.7)
        throw new Error('The pin is outside Lebanon.');
      const p = phoneOf(phone, 'Phone');
      const w = phoneOf(whatsapp, 'WhatsApp') ?? p;
      const { error } = await supabase()
        .from('business_locations')
        .update({
          area_id: areaId,
          address_line: address.trim() || null,
          building: building.trim() || null,
          floor: floor.trim() || null,
          landmark: landmark.trim() || null,
          phone_e164: p,
          whatsapp_e164: w,
          geo: `SRID=4326;POINT(${pin.lng} ${pin.lat})`,
        })
        .eq('id', locationId);
      if (error) throw error;
      await onSaved();
      setMsg({ tone: 'success', text: 'Saved' });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : describeError(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Location"
      description={'Shown as "Hazmieh · Near Mar Takla", then the full details.'}
    >
      <Field label="Area">
        <select className={input} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name_en}
              {a.is_live ? '' : ' (not live yet)'}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Street">
          <input
            className={input}
            value={address}
            maxLength={200}
            onChange={(e) => setAddress(e.target.value)}
          />
        </Field>
        <Field label="Building">
          <input
            className={input}
            value={building}
            maxLength={80}
            onChange={(e) => setBuilding(e.target.value)}
          />
        </Field>
        <Field label="Floor">
          <input
            className={input}
            value={floor}
            maxLength={20}
            onChange={(e) => setFloor(e.target.value)}
          />
        </Field>
        <Field label="Landmark" hint='e.g. "above Bank Audi, next to Spinneys"'>
          <input
            className={input}
            value={landmark}
            maxLength={160}
            onChange={(e) => setLandmark(e.target.value)}
          />
        </Field>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Map pin (drag it or tap the map)</span>
          <button
            type="button"
            className={btn.link}
            onClick={() =>
              navigator.geolocation?.getCurrentPosition(
                (p) => setPin({ lat: p.coords.latitude, lng: p.coords.longitude }),
                () =>
                  setMsg({
                    tone: 'danger',
                    text: "Couldn't get your location. Drag the pin instead.",
                  }),
              )
            }
          >
            Use my location
          </button>
        </div>
        <MapPin lat={pin.lat} lng={pin.lng} onChange={(lat, lng) => setPin({ lat, lng })} />
        <p className="mt-1 text-xs text-ink-500">
          {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone">
          <input
            className={input}
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="WhatsApp" hint="Defaults to the phone number.">
          <input
            className={input}
            type="tel"
            dir="ltr"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </Field>
      </div>
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
