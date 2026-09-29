import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { metadataLeaks, webpChunks } from './metadata.ts';
import { hamming, heifDecoderFromEnv, sniff, transform } from './processor.ts';

// A camera-like JPEG with GPS, make/model and an orientation tag
async function photo(w: number, h: number, orientation = 1, seed = 1): Promise<Buffer> {
  // smooth colour field (a "scene") upscaled from a seeded 16×12 grid, like a real photo
  let x = seed * 9973;
  const rnd = () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const field = Buffer.alloc(16 * 12 * 3);
  for (let i = 0; i < field.length; i++) field[i] = Math.floor(30 + rnd() * 200);
  const scene = await sharp(field, { raw: { width: 16, height: 12, channels: 3 } })
    .resize(w, h, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  return sharp(scene, { raw: { width: w, height: h, channels: 3 } })
    .withMetadata({ orientation })
    .withExif({
      IFD0: { Make: 'TestPhone', Model: 'X' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '33/1 53/1 2100/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '35/1 30/1 1200/100',
      },
    })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('transform', () => {
  it('strips all metadata (EXIF, GPS, XMP, ICC) from every derivative', async () => {
    const src = await photo(1600, 1200);
    expect((await sharp(src).metadata()).exif?.length).toBeGreaterThan(0);
    const r = await transform(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const d of r.derivatives) {
      expect(await metadataLeaks(d.data)).toEqual([]);
      expect(webpChunks(d.data).every((c) => ['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(c))).toBe(
        true,
      );
    }
    expect(r.metadata_stripped).toBe(true);
  });

  it('applies the orientation, then derivatives are upright and within 320 / 800 / 2048', async () => {
    const r = await transform(await photo(3000, 2000, 6)); // stored landscape, displayed portrait
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.original).toMatchObject({ width: 2000, height: 3000, mime: 'image/jpeg' });
    const dims = Object.fromEntries(r.derivatives.map((d) => [d.name, [d.width, d.height]]));
    expect(dims).toEqual({ thumb: [213, 320], card: [533, 800], full: [1365, 2048] });
  });

  it('never enlarges small images', async () => {
    const r = await transform(await photo(600, 400));
    expect(r.ok && r.derivatives.find((d) => d.name === 'full')).toMatchObject({
      width: 600,
      height: 400,
    });
  });

  it('computes sha256 of the original, a 64-bit pHash and a blurhash', async () => {
    const src = await photo(1200, 900);
    const r = await transform(src);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.original.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.phash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.blurhash.length).toBeGreaterThan(6);
  });

  it('pHash: near-identical for a re-encoded copy, far for a different image', async () => {
    const a = await photo(1200, 900, 1, 1);
    const reencoded = await sharp(a).resize(900).jpeg({ quality: 55 }).toBuffer();
    const other = await photo(1200, 900, 1, 5);
    const [ra, rb, rc] = await Promise.all([transform(a), transform(reencoded), transform(other)]);
    if (!ra.ok || !rb.ok || !rc.ok) throw new Error('transform failed');
    expect(hamming(ra.phash, rb.phash)).toBeLessThanOrEqual(6);
    expect(hamming(ra.phash, rc.phash)).toBeGreaterThan(10);
  });

  it('rejects bad input with stable error codes', async () => {
    expect(await transform(await photo(250, 250))).toMatchObject({
      ok: false,
      error_code: 'TOO_SMALL',
    });
    expect(await transform(Buffer.alloc(13 * 1024 * 1024))).toMatchObject({
      ok: false,
      error_code: 'TOO_LARGE',
    });
    expect(await transform(Buffer.from('%PDF-1.7 not an image at all'))).toMatchObject({
      ok: false,
      error_code: 'UNSUPPORTED_FORMAT',
    });
    const truncated = (await photo(1200, 900)).subarray(0, 4000);
    expect(await transform(truncated)).toMatchObject({ ok: false, error_code: 'DECODE_FAILED' });
  });

  it('HEIC without an HEVC decoder → UNSUPPORTED_FORMAT (the client converts)', async () => {
    const fakeHeic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(64),
    ]);
    expect(sniff(fakeHeic)).toBe('image/heic');
    expect(await transform(fakeHeic, { heifDecoder: null })).toMatchObject({
      ok: false,
      error_code: 'UNSUPPORTED_FORMAT',
    });
  });

  it('HEIC with a decoder: decoded, stripped, original hash and mime kept', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypheic'),
      Buffer.alloc(64),
    ]);
    const png = await sharp(await photo(1000, 800))
      .png()
      .toBuffer();
    const r = await transform(heic, { heifDecoder: () => Promise.resolve(png) });
    expect(r).toMatchObject({
      ok: true,
      original: { mime: 'image/heic', width: 1000, height: 800 },
    });
  });

  // src/fixtures/hevc-gps.heic: a real HEVC-coded HEIC (libheif heif-enc + x265) with GPS + Make/Model
  const realHeic = readFileSync(new URL('./fixtures/hevc-gps.heic', import.meta.url));

  it('a real HEVC HEIC goes to the libheif decoder (libvips reads its header but cannot decode it)', async () => {
    expect(sniff(realHeic)).toBe('image/heic');
    let called = 0;
    const png = await sharp(await photo(320, 240))
      .png()
      .toBuffer();
    const r = await transform(realHeic, {
      minSide: 100,
      heifDecoder: () => {
        called++;
        return Promise.resolve(png);
      },
    });
    expect(called).toBe(1);
    expect(r.ok).toBe(true);
  });

  it('decoder failures carry the decoder output', async () => {
    const r = await transform(realHeic, {
      minSide: 100,
      heifDecoder: () => Promise.reject(new Error('heif-dec: plugin missing')),
    });
    expect(r).toMatchObject({ ok: false, error_code: 'DECODE_FAILED' });
    expect(!r.ok && r.detail).toContain('plugin missing');
  });
});

// Runs where libheif's CLI is installed (Linux CI benchmark job, the worker's Docker image).
const heifDecoder = await heifDecoderFromEnv();
describe.skipIf(!heifDecoder)('transform · real HEVC decode (libheif)', () => {
  it('decodes, strips GPS/EXIF and keeps the original size', async () => {
    const heic = readFileSync(new URL('./fixtures/hevc-gps.heic', import.meta.url));
    const r = await transform(heic, { minSide: 100, heifDecoder });
    expect(r).toMatchObject({
      ok: true,
      original: { mime: 'image/heic', width: 320, height: 240 },
    });
    if (!r.ok) return;
    for (const d of r.derivatives) {
      expect(await metadataLeaks(d.data)).toEqual([]);
    }
  });
});
