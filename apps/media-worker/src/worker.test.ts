import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { metadataLeaks } from './metadata.ts';
import { runOnce, type TransformJob, type WorkerStore } from './worker.ts';

const job = (over: Partial<TransformJob> = {}): TransformJob => ({
  msg_id: 1,
  job_id: 'job-1',
  media_id: 'm-1',
  subject: 'review_media',
  attempt: 1,
  source: { bucket: 'ugc-private', path: 'u-1/m-1' },
  outputs: { bucket: 'ugc-staging', prefix: 'm-1/' },
  derivatives: [
    { name: 'thumb', max: 320 },
    { name: 'card', max: 800 },
    { name: 'full', max: 2048 },
  ],
  format: 'webp',
  quality: 80,
  min_side: 300,
  ...over,
});

function fakeStore(files: Record<string, Buffer>, jobs: TransformJob[]) {
  const uploads: Record<string, Buffer> = {};
  const completed: { jobId: string; result: Record<string, unknown> }[] = [];
  let failUploads = false;
  const store: WorkerStore = {
    claim: () => Promise.resolve(jobs.splice(0)),
    complete: (jobId, result) => {
      completed.push({ jobId, result });
      return Promise.resolve(result.ok ? 'classify' : 'rejected');
    },
    download: (bucket, path) => Promise.resolve(files[`${bucket}/${path}`] ?? null),
    upload: (bucket, path, data) => {
      if (failUploads) return Promise.reject(new Error('storage down'));
      uploads[`${bucket}/${path}`] = data;
      return Promise.resolve();
    },
  };
  return { store, uploads, completed, setFailUploads: (v: boolean) => (failUploads = v) };
}

const gpsJpeg = () =>
  sharp({
    create: { width: 1200, height: 900, channels: 3, background: { r: 180, g: 120, b: 90 } },
  })
    .withExif({
      IFD0: { Make: 'TestPhone' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '33/1 53/1 0/1' },
    })
    .jpeg()
    .toBuffer();

describe('media worker', () => {
  it('writes clean derivatives to staging only and reports the contract payload', async () => {
    const { store, uploads, completed } = fakeStore({ 'ugc-private/u-1/m-1': await gpsJpeg() }, [
      job(),
    ]);
    const s = await runOnce(store);
    expect(s).toMatchObject({ claimed: 1, classify: 1 });
    expect(Object.keys(uploads).sort()).toEqual([
      'ugc-staging/m-1/card.webp',
      'ugc-staging/m-1/full.webp',
      'ugc-staging/m-1/thumb.webp',
    ]);
    for (const b of Object.values(uploads)) expect(await metadataLeaks(b)).toEqual([]);
    expect(completed[0]!.result).toMatchObject({
      ok: true,
      processor: 'external',
      metadata_stripped: true,
      outputs: { bucket: 'ugc-staging' },
      original: { mime: 'image/jpeg', width: 1200, height: 900 },
    });
    const derivs = completed[0]!.result.derivatives as { path: string }[];
    expect(derivs.every((d) => d.path.startsWith('m-1/'))).toBe(true);
  });

  it('missing upload → MISSING_OBJECT (not retryable); unreadable file → the processor error', async () => {
    const { store, completed } = fakeStore(
      { 'ugc-private/u-1/bad': Buffer.from('not an image, really') },
      [job(), job({ job_id: 'job-2', source: { bucket: 'ugc-private', path: 'u-1/bad' } })],
    );
    const s = await runOnce(store, { concurrency: 1 });
    expect(s).toMatchObject({ claimed: 2, rejected: 2 });
    expect(completed.map((c) => c.result.error_code)).toEqual([
      'MISSING_OBJECT',
      'UNSUPPORTED_FORMAT',
    ]);
  });

  it('storage errors leave the job for a retry (no callback)', async () => {
    const f = fakeStore({ 'ugc-private/u-1/m-1': await gpsJpeg() }, [job()]);
    f.setFailUploads(true);
    const s = await runOnce(f.store);
    expect(s).toMatchObject({ claimed: 1, retry: 1 });
    expect(f.completed).toEqual([]);
  });
});
