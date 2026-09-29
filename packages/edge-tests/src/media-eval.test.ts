import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  ClaudeImageClassifier,
  NoImageClassifier,
  type ImageClassification,
  type ImageClassifier,
} from '../../../supabase/functions/_shared/media/classifier.ts';
import { DEFAULT_LLM_MODEL } from '../../../supabase/functions/_shared/moderation/classifier.ts';
import {
  evaluateImages,
  formatImageReport,
  loadImageLabels,
  type ImageLabel,
} from '../eval/image-evaluate.ts';

// M10 labelled image set. The scoring itself is tested here with fake classifiers (always runs).
// The real run is opt-in — it needs licensed/consented photos (kept out of git) and an API key:
//   EVAL_IMAGES=1 IMAGE_EVAL_DIR=/path/to/set ANTHROPIC_API_KEY=… [MEDIA_LLM_MODEL=…] \
//     pnpm --filter @app/edge-tests test media-eval
// Passing (DoD) = automatic decisions ≥ 90 % correct AND 0 falsely public. Only then set
// MEDIA_AUTO_PUBLISH=true on the hosted project.

const clean: ImageClassification = {
  safety: { sexual: 0, violence: 0, hate_symbols: 0 },
  ocr: { has_text: false, contact_info: false, qr_code: false, document_or_id: false },
  relevance: 0.9,
  minors_present: false,
  face_count: 1,
  confidence: 0.9,
};
const fake = (byFile: Record<string, Partial<ImageClassification>>): ImageClassifier => ({
  name: 'fake',
  classify: (input) =>
    Promise.resolve({
      ok: true,
      value: { ...clean, ...byFile[new TextDecoder().decode(input.image)] },
      model: 'fake',
      latencyMs: 0,
    }),
});
const label = (
  file: string,
  expected: ImageLabel['expected'],
  category: ImageLabel['category'] = 'hair',
): ImageLabel => ({
  file: `${file}.jpg`,
  category,
  service: 'Haircut',
  canonical: 'haircut',
  expected,
});
// the "image bytes" are the file name, so the fake classifier can key on it
const read = (p: string) => new TextEncoder().encode(p.replace(/^.*[\\/]/, ''));

describe('image eval scoring', () => {
  it('counts automatic accuracy, manual routing and falsely public photos', async () => {
    const labels = [
      label('good', 'approve'),
      label('meme', 'reject', 'meme'),
      label('kid', 'manual_review', 'minor'),
      label('wrong-service', 'reject', 'irrelevant'),
      label('unsure', 'approve'),
    ];
    const r = await evaluateImages(
      fake({
        'meme.jpg': { relevance: 0.05 },
        'kid.jpg': { minors_present: true },
        'wrong-service.jpg': { relevance: 0.9 }, // the classifier gets it wrong → public
        'unsure.jpg': { relevance: 0.6 },
      }),
      '/set',
      labels,
      2,
      read,
    );
    expect(r.total).toBe(5);
    expect(r.automatic).toBe(3);
    expect(r.automaticCorrect).toBe(2);
    expect(r.toManual).toBe(2);
    expect(r.falselyPublic.map((l) => l.file)).toEqual(['wrong-service.jpg']);
    expect(r.falselyRejected).toEqual([]);
    expect(formatImageReport(r)).toContain('falsely public: 1');
  });

  it('without a classifier everything goes to a human (safe, never public)', async () => {
    const r = await evaluateImages(
      new NoImageClassifier(),
      '/set',
      [label('a', 'approve'), label('b', 'reject')],
      1,
      read,
    );
    expect(r.automatic).toBe(0);
    expect(r.toManual).toBe(2);
    expect(r.falselyPublic).toEqual([]);
  });

  it('the example label file is valid', () => {
    const labels = JSON.parse(
      readFileSync(new URL('../eval/image-labels.example.json', import.meta.url), 'utf8'),
    ) as ImageLabel[];
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      expect(['approve', 'manual_review', 'reject']).toContain(l.expected);
      expect(l.file).toMatch(/\.(jpe?g|png|webp)$/i);
    }
  });
});

describe.skipIf(
  !process.env.EVAL_IMAGES || !process.env.IMAGE_EVAL_DIR || !process.env.ANTHROPIC_API_KEY,
)('image eval · Claude (auto-publication gate)', () => {
  it(
    '≥ 90 % of automatic decisions correct, nothing falsely public',
    { timeout: 60 * 60_000 },
    async () => {
      const dir = process.env.IMAGE_EVAL_DIR!;
      const client = new Anthropic({ maxRetries: 4 });
      const model = process.env.MEDIA_LLM_MODEL || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
      const classifier = new ClaudeImageClassifier(
        { beta: { messages: { create: (p, o) => client.beta.messages.create(p, o) } } },
        model,
      );
      const r = await evaluateImages(classifier, dir, loadImageLabels(dir));
      process.stdout.write(`${model}\n${formatImageReport(r)}\n`);
      expect(r.falselyPublic).toEqual([]);
      expect(r.automaticAccuracy).toBeGreaterThanOrEqual(0.9);
    },
  );
});
