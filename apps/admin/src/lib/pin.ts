/**
 * Coordinates from what ops pastes: "33.8547, 35.5323", or a Google Maps link containing
 * "@33.85,35.53" or "q=33.85,35.53" or "!3d33.85!4d35.53".
 */
export function parsePin(raw: string): { lat: number; lng: number } | null {
  const s = raw.trim();
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/,
  ];
  for (const p of patterns) {
    const m = p.exec(s);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

export const inLebanon = (p: { lat: number; lng: number }) =>
  p.lat >= 33 && p.lat <= 34.8 && p.lng >= 35 && p.lng <= 36.7;
