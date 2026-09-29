import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type {
  ImageClassifier,
  ImageInput,
} from '../../../supabase/functions/_shared/media/classifier.ts';
import {
  decideImage,
  type ImageDecision,
} from '../../../supabase/functions/_shared/media/decide.ts';

// M10 labelled image set (DoD: automatic decisions ≥ 90 % correct, the rest routed to manual review,
// never falsely public). The photos are NOT in git (licensing / consent): a folder with labels.json
// (see image-labels.example.json) is passed as IMAGE_EVAL_DIR. The decision is made exactly as in
// production (decideImage) with auto-publication on — the thing the gate is meant to validate.

export type ImageCategory =
  | 'hair'
  | 'nails'
  | 'beard'
  | 'makeup'
  | 'lashes_brows'
  | 'skin'
  | 'irrelevant'
  | 'meme'
  | 'screenshot'
  | 'document'
  | 'contact_info'
  | 'unsafe'
  | 'minor';

export interface ImageLabel {
  file: string;
  category: ImageCategory;
  /** the booked service shown to the classifier as context */
  service: string;
  canonical: string;
  expected: ImageDecision['decision'];
  note?: string;
}

export interface ImageEvalResult {
  total: number;
  /** decided without a human (approve or reject) */
  automatic: number;
  automaticCorrect: number;
  /** automaticCorrect / automatic (1 when nothing was automatic) */
  automaticAccuracy: number;
  /** approved although the label says it must not be public — the gate is 0 */
  falselyPublic: ImageLabel[];
  /** rejected although the label says approve (a customer loses a good photo) */
  falselyRejected: ImageLabel[];
  toManual: number;
  byCategory: Record<string, { total: number; correct: number; manual: number }>;
  failures: { label: ImageLabel; got: ImageDecision }[];
}

const MIME: Record<string, ImageInput['mime']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function loadImageLabels(dir: string): ImageLabel[] {
  return JSON.parse(readFileSync(join(dir, 'labels.json'), 'utf8')) as ImageLabel[];
}

export async function evaluateImages(
  classifier: ImageClassifier,
  dir: string,
  labels: ImageLabel[],
  concurrency = 3,
  read: (path: string) => Uint8Array = (p) => readFileSync(p),
): Promise<ImageEvalResult> {
  const decisions: ImageDecision[] = new Array(labels.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, labels.length) }, async () => {
    while (next < labels.length) {
      const i = next++;
      const l = labels[i]!;
      const mime = MIME[extname(l.file).toLowerCase()];
      if (!mime) throw new Error(`unsupported file type: ${l.file}`);
      const c = await classifier.classify({
        subject: 'review_media',
        image: read(join(dir, l.file)),
        mime,
        context: { service: l.service, canonical: l.canonical },
      });
      decisions[i] = decideImage('review_media', c, {}, true);
    }
  });
  await Promise.all(workers);

  const r: ImageEvalResult = {
    total: labels.length,
    automatic: 0,
    automaticCorrect: 0,
    automaticAccuracy: 1,
    falselyPublic: [],
    falselyRejected: [],
    toManual: 0,
    byCategory: {},
    failures: [],
  };
  labels.forEach((l, i) => {
    const got = decisions[i]!;
    const cat = (r.byCategory[l.category] ??= { total: 0, correct: 0, manual: 0 });
    cat.total++;
    if (got.decision === 'manual_review') {
      r.toManual++;
      cat.manual++;
    } else {
      r.automatic++;
      if (got.decision === l.expected) r.automaticCorrect++;
    }
    if (got.decision === l.expected) cat.correct++;
    else r.failures.push({ label: l, got });
    if (got.decision === 'approve' && l.expected !== 'approve') r.falselyPublic.push(l);
    if (got.decision === 'reject' && l.expected === 'approve') r.falselyRejected.push(l);
  });
  r.automaticAccuracy = r.automatic ? r.automaticCorrect / r.automatic : 1;
  return r;
}

export function formatImageReport(r: ImageEvalResult): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const lines = [
    `images: ${r.total} · automatic ${r.automatic} (${pct(r.automatic / Math.max(1, r.total))}) · manual ${r.toManual}`,
    `automatic accuracy: ${pct(r.automaticAccuracy)} · falsely public: ${r.falselyPublic.length} · falsely rejected: ${r.falselyRejected.length}`,
    ...Object.entries(r.byCategory).map(
      ([k, v]) => `  ${k}: ${v.correct}/${v.total} correct, ${v.manual} to manual`,
    ),
    ...r.failures.map(
      (f) =>
        `  ${f.label.file} [${f.label.category}] expected ${f.label.expected}, got ${f.got.decision} (${f.got.reasons.join(', ')})`,
    ),
  ];
  return lines.join('\n');
}
