// Edge candidate for the M10 image benchmark (EdgeImageProcessor feasibility). Runs in the Supabase
// edge runtime with WASM codecs (sharp/libvips are native and can't run there). Copied into
// supabase/functions/image-bench-edge/ only while benchmarking (bench/edge-run.ts), never deployed.
import decodeJpeg, { init as initJpegDec } from 'npm:@jsquash/jpeg@1.6.0/decode.js';
import decodePng from 'npm:@jsquash/png@3.1.1/decode.js';
import decodeWebp from 'npm:@jsquash/webp@1.5.0/decode.js';
import encodeWebp from 'npm:@jsquash/webp@1.5.0/encode.js';
import resize from 'npm:@jsquash/resize@2.1.1';

void initJpegDec;

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp';
  if (String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return 'heic';
  return null;
}

Deno.serve(async (req) => {
  const t0 = performance.now();
  const buf = new Uint8Array(await req.arrayBuffer());
  const fmt = sniff(buf);
  try {
    if (!fmt || fmt === 'heic')
      return Response.json({ ok: false, error: 'UNSUPPORTED_FORMAT', fmt });
    const t1 = performance.now();
    const img =
      fmt === 'jpeg'
        ? await decodeJpeg(buf.buffer)
        : fmt === 'png'
          ? await decodePng(buf.buffer)
          : await decodeWebp(buf.buffer);
    const t2 = performance.now();
    const sizes: Record<string, number> = { full: 2048, card: 800, thumb: 320 };
    const out: Record<string, number> = {};
    let resizeMs = 0;
    let encodeMs = 0;
    for (const [name, max] of Object.entries(sizes)) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const r0 = performance.now();
      const small = scale < 1 ? await resize(img, { width: w, height: h }) : img;
      const r1 = performance.now();
      const webp = await encodeWebp(small, { quality: 80 });
      encodeMs += performance.now() - r1;
      resizeMs += r1 - r0;
      out[name] = webp.byteLength;
    }
    const sha = await crypto.subtle.digest('SHA-256', buf);
    const mem = Deno.memoryUsage();
    return Response.json({
      ok: true,
      fmt,
      width: img.width,
      height: img.height,
      ms: { decode: t2 - t1, resize: resizeMs, encode: encodeMs, total: performance.now() - t0 },
      out,
      sha: sha.byteLength,
      rssMB: Math.round(mem.rss / 2 ** 20),
      heapMB: Math.round(mem.heapUsed / 2 ** 20),
    });
  } catch (e) {
    return Response.json({
      ok: false,
      error: 'DECODE_FAILED',
      detail: String(e).slice(0, 300),
      ms: performance.now() - t0,
    });
  }
});
