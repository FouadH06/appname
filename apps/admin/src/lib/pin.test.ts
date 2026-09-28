import { describe, expect, it } from 'vitest';
import { inLebanon, parsePin } from './pin';

describe('parsePin', () => {
  it.each([
    ['33.8547, 35.5323', { lat: 33.8547, lng: 35.5323 }],
    ['https://www.google.com/maps/place/X/@33.8938,35.5018,17z', { lat: 33.8938, lng: 35.5018 }],
    ['https://maps.google.com/?q=33.85,35.53', { lat: 33.85, lng: 35.53 }],
    ['https://www.google.com/maps/place/X/data=!3d33.83!4d35.54', { lat: 33.83, lng: 35.54 }],
  ])('%s', (raw, pin) => {
    expect(parsePin(raw)).toEqual(pin);
  });

  it('rejects junk and knows Lebanon', () => {
    expect(parsePin('Hazmieh near Mar Takla')).toBeNull();
    expect(inLebanon({ lat: 33.85, lng: 35.53 })).toBe(true);
    expect(inLebanon({ lat: 48.85, lng: 2.35 })).toBe(false);
  });
});
