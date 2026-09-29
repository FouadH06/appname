import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { encode as encodeBlurhash } from 'blurhash';
import sharp, { type Metadata, type Sharp } from 'sharp';

// ImageProcessor transform (Phase 3 Part 4 §2.6): decode (JPEG/PNG/WebP, HEIC where libvips has an
// HEVC decoder), apply orientation, strip ALL metadata (EXIF/GPS/XMP/ICC comments), re-encode WebP
// derivatives, and compute sha256 (original bytes), 64-bit perceptual hash and blurhash.
// Pure function of the input bytes — the queue/storage wiring lives in worker.ts.

export interface DerivativeSpec {
  name: string;
  max: number;
}

export const DEFAULT_DERIVATIVES: DerivativeSpec[] = [
  { name: 'thumb', max: 320 },
  { name: 'card', max: 800 },
  { name: 'full', max: 2048 },
];

export interface TransformOptions {
  derivatives?: DerivativeSpec[];
  quality?: number;
  maxBytes?: number;
  minSide?: number;
  maxPixels?: number;
  /** HEIC (HEVC) → PNG when libvips has no HEVC decoder (see heifDecoderFromEnv) */
  heifDecoder?: HeifDecoder | null;
}

export type HeifDecoder = (heic: Buffer) => Promise<Buffer>;

/**
 * libheif's `heif-dec` (Debian/Ubuntu package libheif-examples + libheif-plugin-libde265) decodes
 * iPhone HEIC to lossless PNG, applying the container's rotation/mirroring. Returns null when the
 * binary isn't installed — HEIC is then rejected as UNSUPPORTED_FORMAT and the client converts it.
 */
export async function heifDecoderFromEnv(
  candidates = process.env.HEIF_DEC ? [process.env.HEIF_DEC] : ['heif-dec', 'heif-convert'],
): Promise<HeifDecoder | null> {
  const run = promisify(execFile);
  let bin: string | null = null;
  for (const c of candidates) {
    try {
      await run(c, ['--version'], { timeout: 5000 });
      bin = c;
    } catch (e) {
      // only a missing binary counts as "no decoder" (some libheif tools exit non-zero on --version)
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') bin = c;
    }
    if (bin) break;
  }
  if (!bin) return null;
  const decoder = bin;
  return async (heic) => {
    const id = randomUUID();
    const src = join(tmpdir(), `${id}.heic`);
    const dst = join(tmpdir(), `${id}.png`);
    try {
      await writeFile(src, heic);
      try {
        await run(decoder, [src, dst], { timeout: 60_000 });
      } catch (e) {
        const err = e as { stderr?: string; message?: string };
        throw new Error(`${decoder}: ${(err.stderr || err.message || String(e)).trim()}`, {
          cause: e,
        });
      }
      return await readFile(dst);
    } finally {
      await Promise.all([rm(src, { force: true }), rm(dst, { force: true })]);
    }
  };
}

export interface Derivative {
  name: string;
  data: Buffer;
  width: number;
  height: number;
  bytes: number;
}

export type TransformResult =
  | {
      ok: true;
      original: { mime: string; width: number; height: number; bytes: number; sha256: string };
      phash: string;
      blurhash: string;
      derivatives: Derivative[];
      metadata_stripped: true;
      duration_ms: number;
    }
  | { ok: false; error_code: TransformError; retryable: boolean; detail?: string };

export type TransformError =
  'UNSUPPORTED_FORMAT' | 'DECODE_FAILED' | 'TOO_LARGE' | 'TOO_SMALL' | 'TIMEOUT';

const MIME: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heif: 'image/heic',
};

/** Magic bytes, before any decoder touches the file. */
export function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
  }
  return null;
}

export async function transform(
  input: Buffer,
  opts: TransformOptions = {},
): Promise<TransformResult> {
  const started = performance.now();
  const maxBytes = opts.maxBytes ?? 12 * 1024 * 1024;
  const minSide = opts.minSide ?? 300;
  if (input.length > maxBytes) return { ok: false, error_code: 'TOO_LARGE', retryable: false };
  const sniffed = sniff(input);
  if (!sniffed) return { ok: false, error_code: 'UNSUPPORTED_FORMAT', retryable: false };

  let decodable = input;
  if (sniffed === 'image/heic') {
    // libvips (prebuilt) only decodes AVIF-coded HEIF; iPhone photos are HEVC → libheif CLI.
    // metadata() only parses the header (it succeeds for HEVC too), so decide on the codec.
    const canVips = await sharp(input)
      .metadata()
      .then(
        (m) => m.compression === 'av1',
        () => false,
      );
    if (!canVips) {
      if (!opts.heifDecoder)
        return {
          ok: false,
          error_code: 'UNSUPPORTED_FORMAT',
          retryable: false,
          detail: 'no HEVC decoder',
        };
      try {
        decodable = await opts.heifDecoder(input);
      } catch (e) {
        return {
          ok: false,
          error_code: 'DECODE_FAILED',
          retryable: false,
          detail: String(e).slice(0, 200),
        };
      }
    }
  }

  let img: Sharp;
  let meta: Metadata;
  try {
    // limitInputPixels guards decompression bombs; failOn 'error' rejects truncated/corrupt files
    img = sharp(decodable, {
      failOn: 'error',
      limitInputPixels: opts.maxPixels ?? 60_000_000,
      sequentialRead: true,
    });
    meta = await img.metadata();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const unsupported = /unsupported|no decoder|bad seek|not a known file format|heif/i.test(msg);
    return {
      ok: false,
      error_code: /pixel limit/i.test(msg)
        ? 'TOO_LARGE'
        : unsupported
          ? 'UNSUPPORTED_FORMAT'
          : 'DECODE_FAILED',
      retryable: false,
      detail: msg.slice(0, 200),
    };
  }
  // orientation 5–8 swaps width and height once applied
  const swap = (meta.orientation ?? 1) >= 5;
  const width = (swap ? meta.height : meta.width) ?? 0;
  const height = (swap ? meta.width : meta.height) ?? 0;
  if (Math.min(width, height) < minSide)
    return { ok: false, error_code: 'TOO_SMALL', retryable: false };

  try {
    // one decoded, oriented base; every output is a fresh encode without metadata (sharp drops
    // EXIF/XMP/IPTC/ICC unless keepMetadata/withMetadata is requested — we never request it)
    const base = img.clone().rotate();
    const derivatives: Derivative[] = [];
    for (const d of opts.derivatives ?? DEFAULT_DERIVATIVES) {
      const { data, info } = await base
        .clone()
        .resize({ width: d.max, height: d.max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: opts.quality ?? 80, effort: 3 })
        .toBuffer({ resolveWithObject: true });
      derivatives.push({
        name: d.name,
        data,
        width: info.width,
        height: info.height,
        bytes: info.size,
      });
    }
    const small = await base.clone().resize(32, 32, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
    const grey = await base.clone().resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
    return {
      ok: true,
      original: {
        mime: sniffed === 'image/heic' ? 'image/heic' : (MIME[meta.format ?? ''] ?? sniffed),
        width,
        height,
        bytes: input.length,
        sha256: createHash('sha256').update(input).digest('hex'),
      },
      phash: phash64(grey),
      blurhash: encodeBlurhash(new Uint8ClampedArray(small), 32, 32, 4, 3),
      derivatives,
      metadata_stripped: true,
      duration_ms: Math.round(performance.now() - started),
    };
  } catch (e) {
    return {
      ok: false,
      error_code: 'DECODE_FAILED',
      retryable: false,
      detail: String(e).slice(0, 200),
    };
  }
}

// ─── 64-bit DCT perceptual hash (32×32 greyscale → DCT → top-left 8×8 without DC → median) ──
const N = 32;
const COS = Array.from({ length: N }, (_, k) =>
  Array.from({ length: N }, (_, n) => Math.cos(((2 * n + 1) * k * Math.PI) / (2 * N))),
);

export function phash64(grey32: Buffer): string {
  const px = (x: number, y: number) => grey32[y * N + x]!;
  const coeffs: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) sum += px(x, y) * COS[u]![x]! * COS[v]![y]!;
      coeffs.push(sum);
    }
  }
  const ac = coeffs.slice(1); // drop the DC term
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)]!;
  let bits = 0n;
  for (const c of coeffs) bits = (bits << 1n) | (c > median ? 1n : 0n);
  return bits.toString(16).padStart(16, '0');
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
