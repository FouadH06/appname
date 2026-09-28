'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';

/**
 * Drag-the-pin map (Phase 2 B1 step 3) on OpenStreetMap tiles. Leaflet loads only in the browser.
 * Lebanon bounds keep the map where businesses are.
 */
export function MapPin({
  lat,
  lng,
  onChange,
}: {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, {
        maxBounds: [
          [32.9, 34.9],
          [34.9, 36.8],
        ],
      }).setView([lat, lng], 16);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(m);
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:var(--accent-600);transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 22],
      });
      const mk = L.marker([lat, lng], { draggable: true, icon }).addTo(m);
      mk.on('dragend', () => {
        const p = mk.getLatLng();
        cb.current(p.lat, p.lng);
      });
      m.on('click', (e) => {
        mk.setLatLng(e.latlng);
        cb.current(e.latlng.lat, e.latlng.lng);
      });
      map.current = m;
      marker.current = mk;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // the map is created once; later position changes are applied below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mk = marker.current;
    if (!mk) return;
    const p = mk.getLatLng();
    if (Math.abs(p.lat - lat) > 1e-7 || Math.abs(p.lng - lng) > 1e-7) {
      mk.setLatLng([lat, lng]);
      map.current?.panTo([lat, lng]);
    }
  }, [lat, lng]);

  return (
    <div
      ref={el}
      className="h-64 w-full overflow-hidden rounded-control border border-line-200"
      data-testid="map-pin"
    />
  );
}
