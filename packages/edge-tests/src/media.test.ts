import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildImageRequest,
  ClaudeImageClassifier,
  LocalImageClassifier,
  parseImageClassification,
  type ClaudeImageClient,
  type ImageClassification,
  type ImageInput,
} from '../../../supabase/functions/_shared/media/classifier.ts';
import { mediaConfigFromEnv } from '../../../supabase/functions/_shared/media/config.ts';
import { decideImage } from '../../../supabase/functions/_shared/media/decide.ts';
import {
  runOrchestrator,
  type ClassifyJob,
  type MediaStore,
} from '../../../supabase/functions/_shared/media/orchestrator.ts';
import { photoReason } from '../../../supabase/functions/_shared/notify/render.ts';

const clean: ImageClassification = {
  safety: { sexual: 0.01, violence: 0, hate_symbols: 0 },
  ocr: { has_text: false, contact_info: false, qr_code: false, document_or_id: false },
  relevance: 0.92,
  minors_present: false,
  face_count: 1,
  confidence: 0.9,
};
const ok = (v: Partial<ImageClassification> = {}) => ({
  ok: true as const,
  value: { ...clean, ...v },
  model: 'm',
  latencyMs: 1,
});

describe('image decision matrix (Part 4 §3.2)', () => {
  it('safety: hard → reject, grey → human', () => {
    expect(
      decideImage(
        'review_media',
        ok({ safety: { sexual: 0.95, violence: 0, hate_symbols: 0 } }),
        {},
        true,
      ),
    ).toMatchObject({
      decision: 'reject',
      reasonCode: 'guidelines',
    });
    expect(
      decideImage(
        'review_media',
        ok({ safety: { sexual: 0, violence: 0.5, hate_symbols: 0 } }),
        {},
        true,
      ).decision,
    ).toBe('manual_review');
  });
  it('OCR: documents → human, contact details / QR → reject', () => {
    expect(
      decideImage('review_media', ok({ ocr: { ...clean.ocr, document_or_id: true } }), {}, true)
        .reasons,
    ).toEqual(['document']);
    expect(
      decideImage('review_media', ok({ ocr: { ...clean.ocr, qr_code: true } }), {}, true)
        .reasonCode,
    ).toBe('contact_info');
  });
  it('relevance: < 0.40 reject, 0.40–0.75 human, ≥ 0.75 approve; minors → human + flag', () => {
    expect(decideImage('review_media', ok({ relevance: 0.2 }), {}, true)).toMatchObject({
      decision: 'reject',
      reasonCode: 'not_relevant',
    });
    expect(decideImage('review_media', ok({ relevance: 0.6 }), {}, true).reasons).toEqual([
      'relevance_unsure',
    ]);
    expect(decideImage('review_media', ok(), {}, true).decision).toBe('approve');
    expect(decideImage('review_media', ok({ minors_present: true }), {}, true)).toMatchObject({
      decision: 'manual_review',
      minor: true,
    });
  });
  it('never publishes without auto-publication; refusals and failures go to a human', () => {
    expect(decideImage('review_media', ok(), {}, false)).toMatchObject({
      decision: 'manual_review',
      reasons: ['auto_publish_off'],
    });
    const refused = {
      ok: false as const,
      reason: 'refusal' as const,
      detail: '',
      model: 'm',
      latencyMs: 1,
    };
    expect(decideImage('review_media', refused, {}, true).reasons).toEqual(['classifier_refusal']);
  });
  it('business media (already public): only violations remove or escalate; relevance ignored', () => {
    expect(decideImage('business_media', ok({ relevance: null }), {}, false).decision).toBe(
      'approve',
    );
    expect(
      decideImage('business_media', ok({ safety: { sexual: 0.99, violence: 0, hate_symbols: 0 } }))
        .decision,
    ).toBe('reject');
  });
  it('thresholds come from config', () => {
    expect(
      decideImage('review_media', ok({ relevance: 0.6 }), { relevance_pass: 0.5 }, true).decision,
    ).toBe('approve');
  });
});

const input: ImageInput = {
  subject: 'review_media',
  image: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
  mime: 'image/webp',
  context: {
    service: 'Skin fade',
    canonical: "Men's haircut",
    hints: ['short sides', 'hair'],
    business: 'Fade District',
  },
};

describe('Claude image classifier', () => {
  it('request is accepted by the SDK types: image block, cached system prompt, structured output, fallbacks', () => {
    const req = buildImageRequest(input, 'claude-sonnet-5');
    const sdk: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = req;
    expect(sdk.model).toBe('claude-sonnet-5');
    expect(req.fallbacks).toBe('default');
    expect(req.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(req.messages[0]?.content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/webp' },
    });
    expect(req.messages[0]?.content[1]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(req.messages[0]?.content[1])).toContain('Skin fade');
  });

  it('parses and clamps; refusal / bad output / network → not ok', async () => {
    expect(parseImageClassification({ ...clean, relevance: 3 })?.relevance).toBe(1);
    expect(parseImageClassification({ ...clean, safety: {} })).toBeNull();
    const reply = (r: unknown) => {
      const create = vi.fn(() => (r instanceof Error ? Promise.reject(r) : Promise.resolve(r)));
      return new ClaudeImageClassifier(
        { beta: { messages: { create } } } as unknown as ClaudeImageClient,
        'claude-sonnet-5',
      );
    };
    await expect(
      reply({
        model: 'm',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(clean) }],
      }).classify(input),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      reply({ model: 'm', stop_reason: 'refusal', content: [] }).classify(input),
    ).resolves.toMatchObject({ ok: false, reason: 'refusal' });
    await expect(
      reply({
        model: 'm',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{}' }],
      }).classify(input),
    ).resolves.toMatchObject({ ok: false, reason: 'invalid' });
    await expect(reply(new Error('overloaded')).classify(input)).resolves.toMatchObject({
      ok: false,
      reason: 'error',
    });
  });
});

describe('media config (auto-publication principle)', () => {
  const make = vi.fn(
    () => ({ beta: { messages: { create: vi.fn() } } }) as unknown as ClaudeImageClient,
  );
  it('local stack: stub classifier, auto-publication on', () => {
    expect(
      mediaConfigFromEnv((n) => ({ SUPABASE_URL: 'http://kong:8000' })[n], make),
    ).toMatchObject({ mode: 'local', autoPublish: true });
  });
  it('hosted without a key: every image to a moderator', async () => {
    const c = mediaConfigFromEnv((n) => ({ SUPABASE_URL: 'https://x.supabase.co' })[n], make);
    expect(c).toMatchObject({ mode: 'none', autoPublish: false });
    expect(
      decideImage('review_media', await c.classifier.classify(input), {}, c.autoPublish).decision,
    ).toBe('manual_review');
  });
  it('hosted with a key: Claude (Sonnet 5 default), still no auto-publication until MEDIA_AUTO_PUBLISH', () => {
    const c = mediaConfigFromEnv(
      (n) => ({ SUPABASE_URL: 'https://x.supabase.co', ANTHROPIC_API_KEY: 'k' })[n],
      make,
    );
    expect(c).toMatchObject({ mode: 'llm', autoPublish: false });
    expect(c.classifier.name).toBe('claude-sonnet-5');
    expect(
      mediaConfigFromEnv(
        (n) =>
          ({
            SUPABASE_URL: 'https://x.supabase.co',
            ANTHROPIC_API_KEY: 'k',
            MEDIA_AUTO_PUBLISH: 'true',
          })[n],
        make,
      ).autoPublish,
    ).toBe(true);
  });
});

describe('orchestrator', () => {
  function store(over: Partial<MediaStore> = {}) {
    const calls: string[] = [];
    const s: MediaStore = {
      claimClassify: () =>
        Promise.resolve([
          {
            msg_id: 1,
            media_id: 'm1',
            subject: 'review_media',
            run_id: 'r1',
            attempt: 1,
            image: { bucket: 'ugc-staging', path: 'm1/card.webp' },
            context: { service: 'Cut' },
            config: {},
          } satisfies ClassifyJob,
        ]),
      recordClassification: (a) => {
        calls.push(`record:${a.decision}:${a.reasons.join(',')}`);
        return Promise.resolve(a.decision);
      },
      claimPublish: () =>
        Promise.resolve([
          {
            msg_id: 2,
            media_id: 'm2',
            derivatives: [
              { name: 'card', path: 'm2/card.webp', width: 800, height: 600, bytes: 1 },
            ],
          },
        ]),
      publishComplete: () => Promise.resolve('published'),
      claimCleanup: () =>
        Promise.resolve([{ msg_id: 3, bucket: 'ugc-staging', paths: ['m9/card.webp'] }]),
      cleanupDone: (id) => {
        calls.push(`done:${id}`);
        return Promise.resolve();
      },
      download: () => Promise.resolve(new Uint8Array([1, 2, 3])),
      copy: (fb, fp, tb, tp) => {
        calls.push(`copy:${fb}/${fp}->${tb}/${tp}`);
        return Promise.resolve();
      },
      remove: (b, p) => {
        calls.push(`remove:${b}:${p.join(',')}`);
        return Promise.resolve();
      },
      ...over,
    };
    return { s, calls };
  }

  it('classify → record; publish copies staging → ugc-public then confirms; cleanup deletes', async () => {
    const { s, calls } = store();
    const r = await runOrchestrator({
      store: s,
      classifier: new LocalImageClassifier(),
      autoPublish: true,
    });
    expect(r).toMatchObject({ classified: { approve: 1 }, published: 1, cleaned: 1, errors: 0 });
    expect(calls).toEqual([
      'record:approve:',
      'copy:ugc-staging/m2/card.webp->ugc-public/m2/card.webp',
      'remove:ugc-staging:m9/card.webp',
      'done:3',
    ]);
  });

  it('removed while publishing → the public copies are deleted at once', async () => {
    const { s, calls } = store({ publishComplete: () => Promise.resolve('stale') });
    const r = await runOrchestrator({
      store: s,
      classifier: new LocalImageClassifier(),
      autoPublish: true,
    });
    expect(r.stale).toBe(1);
    expect(calls).toContain('remove:ugc-public:m2/card.webp');
  });

  it('auto-publication off: the approval becomes a human review', async () => {
    const { s, calls } = store();
    await runOrchestrator({ store: s, classifier: new LocalImageClassifier(), autoPublish: false });
    expect(calls[0]).toBe('record:manual_review:auto_publish_off');
  });

  it('temporary classifier errors leave the job queued (no record)', async () => {
    const { s, calls } = store();
    const failing = {
      name: 'x',
      classify: () =>
        Promise.resolve({
          ok: false as const,
          reason: 'error' as const,
          detail: '',
          model: 'x',
          latencyMs: 0,
        }),
    };
    const r = await runOrchestrator({ store: s, classifier: failing, autoPublish: true });
    expect(r.errors).toBe(1);
    expect(calls.some((c) => c.startsWith('record'))).toBe(false);
  });
});

describe('photo rejection reasons (customer-facing)', () => {
  it('turns codes into sentences, never safety details', () => {
    expect(photoReason('not_relevant', 'Skin fade', 'en')).toBe(
      "it doesn't seem to show your Skin fade.",
    );
    expect(photoReason('contact_info', '', 'ar')).toBe('تحتوي على معلومات تواصل أو رمز QR.');
    expect(photoReason('nudity_explicit_internal', '', 'en')).toBe(
      "it doesn't follow our photo guidelines.",
    );
  });
});
