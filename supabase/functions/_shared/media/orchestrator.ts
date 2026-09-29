import { rpc } from '../otp/store.ts';
import type { Fetch } from '../otp/types.ts';
import type { ImageClassifier } from './classifier.ts';
import { decideImage, type MediaConfig } from './decide.ts';

// media-orchestrator (Phase 3 Part 4 §2.6): the light, I/O-only steps after the ImageProcessor —
// classify (staging card image → ImageClassifier → decision → DB), publish (copy staging →
// ugc-public, then confirm; if the photo was removed meanwhile, delete the copies) and cleanup
// (storage deletions queued by removals, rejections and retention).

export interface ClassifyJob {
  msg_id: number;
  media_id: string;
  subject: 'review_media' | 'business_media';
  run_id: string;
  attempt: number;
  image: { bucket: string; path: string | null };
  context: Record<string, unknown>;
  config: MediaConfig;
}

export interface Derivative {
  name: string;
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export interface PublishJob {
  msg_id: number;
  media_id: string;
  derivatives: Derivative[];
}

export interface CleanupJob {
  msg_id: number;
  bucket: string;
  paths: string[];
}

export interface MediaStore {
  claimClassify(limit: number): Promise<ClassifyJob[]>;
  recordClassification(args: {
    msgId: number;
    mediaId: string;
    runId: string;
    decision: string;
    reasons: string[];
    stages: unknown[];
    minor: boolean;
    reasonCode: string | null;
  }): Promise<string>;
  claimPublish(limit: number): Promise<PublishJob[]>;
  publishComplete(msgId: number, mediaId: string, publicDerivatives: Derivative[]): Promise<string>;
  claimCleanup(limit: number): Promise<CleanupJob[]>;
  cleanupDone(msgId: number): Promise<void>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  copy(fromBucket: string, fromPath: string, toBucket: string, toPath: string): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
}

export interface OrchestratorDeps {
  store: MediaStore;
  classifier: ImageClassifier;
  autoPublish: boolean;
  limit?: number;
  log?: (line: string) => void;
}

export interface OrchestratorSummary {
  classified: Record<string, number>;
  published: number;
  stale: number;
  cleaned: number;
  errors: number;
}

export async function runOrchestrator(deps: OrchestratorDeps): Promise<OrchestratorSummary> {
  const { store, log } = deps;
  const limit = deps.limit ?? 10;
  const s: OrchestratorSummary = { classified: {}, published: 0, stale: 0, cleaned: 0, errors: 0 };

  for (const job of await store.claimClassify(limit)) {
    try {
      const bytes = job.image.path ? await store.download(job.image.bucket, job.image.path) : null;
      const c = bytes
        ? await deps.classifier.classify({
            subject: job.subject,
            image: bytes,
            mime: 'image/webp',
            context: job.context as never,
          })
        : ({
            ok: false,
            reason: 'invalid',
            detail: 'derivative missing',
            model: 'none',
            latencyMs: 0,
          } as const);
      // a temporary classifier error stays in the queue (the DB hands it to a human after 3 tries)
      if (!c.ok && c.reason === 'error') {
        s.errors += 1;
        continue;
      }
      const d = decideImage(job.subject, c, job.config, deps.autoPublish);
      const stages = [
        {
          stage: 'safety',
          outcome: c.ok ? 'pass' : 'error',
          model: c.model,
          latency_ms: c.latencyMs,
          scores: c.ok ? c.value.safety : {},
          labels: c.ok ? [] : [c.reason],
        },
        ...(c.ok
          ? [
              {
                stage: 'ocr',
                outcome:
                  c.value.ocr.contact_info || c.value.ocr.qr_code || c.value.ocr.document_or_id
                    ? 'flag'
                    : 'pass',
                scores: c.value.ocr,
              },
              {
                stage: 'relevance',
                outcome:
                  c.value.relevance === null ||
                  c.value.relevance >= (job.config.relevance_pass ?? 0.75)
                    ? 'pass'
                    : 'flag',
                scores: {
                  relevance: c.value.relevance,
                  minors_present: c.value.minors_present,
                  face_count: c.value.face_count,
                  confidence: c.value.confidence,
                },
              },
            ]
          : []),
        {
          stage: 'decision',
          outcome: d.decision === 'approve' ? 'pass' : d.decision === 'reject' ? 'fail' : 'flag',
          labels: d.reasons,
        },
      ];
      const r = await store.recordClassification({
        msgId: job.msg_id,
        mediaId: job.media_id,
        runId: job.run_id,
        decision: d.decision,
        reasons: d.reasons,
        stages,
        minor: d.minor,
        reasonCode: d.reasonCode,
      });
      s.classified[r] = (s.classified[r] ?? 0) + 1;
    } catch (e) {
      s.errors += 1;
      log?.(
        `media: classify ${job.media_id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  for (const job of await store.claimPublish(limit)) {
    const copied: string[] = [];
    try {
      const pub: Derivative[] = [];
      for (const d of job.derivatives ?? []) {
        await store.copy('ugc-staging', d.path, 'ugc-public', d.path);
        copied.push(d.path);
        pub.push(d);
      }
      const r = await store.publishComplete(job.msg_id, job.media_id, pub);
      if (r === 'published') s.published += 1;
      else {
        s.stale += 1;
        await store.remove('ugc-public', copied); // removed while we were copying: never stay public
      }
    } catch (e) {
      s.errors += 1;
      if (copied.length) await store.remove('ugc-public', copied).catch(() => undefined);
      log?.(`media: publish ${job.media_id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const job of await store.claimCleanup(limit * 2)) {
    try {
      if (job.paths.length) await store.remove(job.bucket, job.paths);
      await store.cleanupDone(job.msg_id);
      s.cleaned += job.paths.length;
    } catch (e) {
      s.errors += 1;
      log?.(`media: cleanup ${job.bucket} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (Object.keys(s.classified).length || s.published || s.stale || s.cleaned || s.errors)
    log?.(`media: ${JSON.stringify(s)}`);
  return s;
}

export function supabaseMediaStore(url: string, key: string, fetchFn: Fetch = fetch): MediaStore {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const call = <T>(name: string, args: Record<string, unknown>) =>
    rpc<T>(fetchFn, url, key, name, args);
  const obj = (bucket: string, path: string) =>
    `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`;
  return {
    claimClassify: (limit) =>
      call<ClassifyJob[]>('media_claim_classify', { p_limit: limit, p_vt: 120 }),
    recordClassification: (a) =>
      call<string>('media_classification_record', {
        p_msg_id: a.msgId,
        p_media_id: a.mediaId,
        p_run_id: a.runId,
        p_decision: a.decision,
        p_reasons: a.reasons,
        p_stages: a.stages,
        p_minor: a.minor,
        p_reason_code: a.reasonCode,
      }),
    claimPublish: (limit) =>
      call<PublishJob[]>('media_claim_publish', { p_limit: limit, p_vt: 120 }),
    publishComplete: (msgId, mediaId, pub) =>
      call<string>('media_publish_complete', {
        p_msg_id: msgId,
        p_media_id: mediaId,
        p_public: pub,
      }),
    claimCleanup: (limit) =>
      call<CleanupJob[]>('media_claim_cleanup', { p_limit: limit, p_vt: 120 }),
    cleanupDone: async (msgId) => {
      await call('media_cleanup_done', { p_msg_id: msgId });
    },
    download: async (bucket, path) => {
      const res = await fetchFn(obj(bucket, path), {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`download ${bucket}/${path}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    copy: async (fromBucket, fromPath, toBucket, toPath) => {
      const res = await fetchFn(`${url}/storage/v1/object/copy`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucketId: fromBucket,
          sourceKey: fromPath,
          destinationBucket: toBucket,
          destinationKey: toPath,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      // already copied by an earlier attempt: fine (publishing is idempotent)
      if (!res.ok && res.status !== 409)
        throw new Error(`copy ${fromPath}: ${res.status} ${await res.text()}`);
    },
    remove: async (bucket, paths) => {
      if (!paths.length) return;
      const res = await fetchFn(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`delete ${bucket}: ${res.status} ${await res.text()}`);
    },
  };
}
