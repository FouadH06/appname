// Image benchmark corpus (M10). Synthetic, photo-like images (smooth structure + sensor-like noise, so
// they compress like camera photos) in the formats phones produce, each carrying EXIF with a GPS
// position, camera make/model and an orientation, so metadata stripping and auto-rotation are
// exercised. Sizes from 0.3 MP to 24 MP plus panoramas, all ≤ 12 MB. HEIC (HEVC) files are generated
// separately on Linux with heif-enc (see bench/README.md) — no HEVC encoder is available here.
// Usage: node --experimental-strip-types bench/corpus.ts [outDir] [count]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const out = process.argv[2] ?? 'bench/corpus';
const count = Number(process.argv[3] ?? 200);
mkdirSync(out, { recursive: true });

const SIZES: [number, number][] = [
  [640, 480],
  [1080, 1350],
  [1200, 1600],
  [1536, 2048],
  [2048, 1536],
  [3024, 4032],
  [4032, 3024],
  [3000, 4000],
  [4000, 3000],
  [4624, 3472],
  [6000, 4000],
  [8000, 1500],
  [12000, 2000],
  [720, 1280],
];
const FORMATS = ['jpeg', 'jpeg', 'jpeg', 'png', 'webp'] as const; // phones mostly send JPEG

// deterministic PRNG so the corpus is reproducible
let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

async function photoLike(w: number, h: number): Promise<Buffer> {
  // low-res colour field upscaled (smooth "scene") + fine noise (sensor grain)
  const lw = 24;
  const lh = Math.max(4, Math.round((24 * h) / w));
  const field = Buffer.alloc(lw * lh * 3);
  for (let i = 0; i < field.length; i++) field[i] = Math.floor(40 + rnd() * 180);
  const scene = await sharp(field, { raw: { width: lw, height: lh, channels: 3 } })
    .resize(w, h, { kernel: 'cubic' })
    .raw()
    .toBuffer();
  for (let i = 0; i < scene.length; i++)
    scene[i] = Math.max(0, Math.min(255, scene[i]! + Math.round((rnd() - 0.5) * 18)));
  return scene;
}

const manifest: object[] = [];
for (let i = 0; i < count; i++) {
  const [w, h] = SIZES[i % SIZES.length]!;
  const format = FORMATS[i % FORMATS.length]!;
  const orientation = [1, 1, 6, 3, 8][i % 5]!;
  const raw = await photoLike(w, h);
  let quality = 92;
  let buf: Buffer;
  do {
    let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .withMetadata({ orientation })
      .withExif({
        IFD0: {
          Make: 'TestPhone',
          Model: `Model ${i % 7}`,
          Software: 'bench',
          ImageDescription: `bench image ${i}`,
        },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '33/1 53/1 2100/100',
          GPSLongitudeRef: 'E',
          GPSLongitude: '35/1 30/1 1200/100',
        },
      });
    img =
      format === 'jpeg'
        ? img.jpeg({ quality })
        : format === 'png'
          ? img.png({ compressionLevel: 6 })
          : img.webp({ quality });
    buf = await img.toBuffer();
    quality -= 8;
  } while (buf.length > 12 * 1024 * 1024 && quality > 40 && format !== 'png');
  if (buf.length > 12 * 1024 * 1024) {
    // PNG of a huge panorama can't fit: scale it down (phones don't send 30 MB PNGs anyway)
    buf = await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .resize(Math.round(w / 2))
      .png()
      .toBuffer();
  }
  const name = `${String(i).padStart(3, '0')}-${w}x${h}-o${orientation}.${format === 'jpeg' ? 'jpg' : format}`;
  writeFileSync(join(out, name), buf);
  manifest.push({ name, format, width: w, height: h, orientation, bytes: buf.length });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
process.stdout.write(`${manifest.length} images written to ${out}\n`);
