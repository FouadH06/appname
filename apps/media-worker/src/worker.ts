import sharp from 'sharp';
import { type DerivativeSpec, type HeifDecoder, transform } from './processor.ts';

// Queue side of the ExternalImageProcessor (Part 4 §2.6 worker contract): claim transform jobs,
// read the original from the private bucket, write derivatives to ugc-staging, report the result
// through media_processing_complete. Temporary failures (storage/network) leave the job in the
// queue; after 3 attempts the database hands it to a human ('processing_error').

export const PROCESSOR_VERSION = `media-worker/1 vips/${sharp.versions.vips}`;

export interface TransformJob {
  msg_id: number;
  job_id: string;
  media_id: string;
  subject: 'review_media' | 'business_media';
  attempt: number;
  source: { bucket: string; path: string };
  outputs: { bucket: string; prefix: string };
  derivatives: DerivativeSpec[];
  format: 'webp';
  quality: number;
  min_side?: number;
}

export interface WorkerStore {
  claim(limit: number): Promise<TransformJob[]>;
  complete(jobId: string, result: Record<string, unknown>, msgId: number): Promise<string>;
  /** null when the object doesn't exist */
  download(bucket: string, path: string): Promise<Buffer | null>;
  upload(bucket: string, path: string, data: Buffer, contentType: string): Promise<void>;
}

export interface RunSummary {
  claimed: number;
  classify: number;
  rejected: number;
  retry: number;
}

export async function processJob(
  job: TransformJob,
  store: WorkerStore,
  heifDecoder: HeifDecoder | null,
): Promise<string> {
  const original = await store.download(job.source.bucket, job.source.path);
  if (!original) {
    return store.complete(
      job.job_id,
      { ok: false, error_code: 'MISSING_OBJECT', retryable: false, processor: 'external' },
      job.msg_id,
    );
  }
  const r = await transform(original, {
    derivatives: job.derivatives,
    quality: job.quality,
    minSide: job.min_side,
    heifDecoder,
  });
  if (!r.ok) {
    return store.complete(
      job.job_id,
      { ...r, processor: 'external', processor_version: PROCESSOR_VERSION },
      job.msg_id,
    );
  }
  const derivatives = [];
  for (const d of r.derivatives) {
    const path = `${job.outputs.prefix}${d.name}.webp`;
    await store.upload(job.outputs.bucket, path, d.data, 'image/webp');
    derivatives.push({ name: d.name, path, width: d.width, height: d.height, bytes: d.bytes });
  }
  return store.complete(
    job.job_id,
    {
      ok: true,
      processor: 'external',
      processor_version: PROCESSOR_VERSION,
      original: r.original,
      phash: r.phash,
      blurhash: r.blurhash,
      derivatives,
      outputs: { bucket: job.outputs.bucket },
      metadata_stripped: r.metadata_stripped,
      duration_ms: r.duration_ms,
    },
    job.msg_id,
  );
}

export async function runOnce(
  store: WorkerStore,
  opts: {
    limit?: number;
    concurrency?: number;
    heifDecoder?: HeifDecoder | null;
    log?: (l: string) => void;
  } = {},
): Promise<RunSummary> {
  const jobs = await store.claim(opts.limit ?? 8);
  const summary: RunSummary = { claimed: jobs.length, classify: 0, rejected: 0, retry: 0 };
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const outcome = await processJob(job, store, opts.heifDecoder ?? null);
        if (outcome === 'classify') summary.classify += 1;
        else if (outcome === 'rejected') summary.rejected += 1;
        else summary.retry += 1;
      } catch (e) {
        summary.retry += 1; // stays in the queue; visible again after the timeout
        opts.log?.(
          `media-worker: job ${job.job_id} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 2) }, worker));
  if (jobs.length) opts.log?.(`media-worker: ${JSON.stringify(summary)}`);
  return summary;
}

/** PostgREST + Storage REST with the service key (server-side only). */
export function supabaseStore(
  url: string,
  serviceKey: string,
  fetchFn: typeof fetch = fetch,
): WorkerStore {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await fetchFn(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`rpc ${name}: ${res.status} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  const objectUrl = (bucket: string, path: string) =>
    `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return {
    claim: (limit) => rpc<TransformJob[]>('media_claim_transform', { p_limit: limit, p_vt: 180 }),
    complete: (jobId, result, msgId) =>
      rpc<string>('media_processing_complete', {
        p_job_id: jobId,
        p_result: result,
        p_msg_id: msgId,
      }),
    download: async (bucket, path) => {
      const res = await fetchFn(objectUrl(bucket, path), {
        headers,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404 || res.status === 400) return null; // storage answers 400 "not found" for missing keys
      if (!res.ok) throw new Error(`download ${bucket}/${path}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    upload: async (bucket, path, data, contentType) => {
      const res = await fetchFn(objectUrl(bucket, path), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': contentType,
          'x-upsert': 'true',
          'cache-control': 'max-age=31536000',
        },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`upload ${bucket}/${path}: ${res.status} ${await res.text()}`);
    },
  };
}
