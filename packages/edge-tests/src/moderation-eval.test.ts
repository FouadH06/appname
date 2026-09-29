import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  ClaudeClassifier,
  DEFAULT_LLM_MODEL,
  HeuristicClassifier,
} from '../../../supabase/functions/_shared/moderation/classifier.ts';
import { evalItems, evaluate, formatReport } from '../eval/evaluate.ts';

// Moderation quality on the labelled set (eval/moderation-set.json, 200+ reviews in EN/AR/FR/
// Arabizi/mixed). CI runs the keyword classifier as a regression floor. The Claude run is opt-in
// (costs API credits): EVAL_LLM=1 ANTHROPIC_API_KEY=… [LLM_MODEL=…] pnpm --filter @app/edge-tests test moderation-eval

const tuned = evalItems.filter((i) => !i.holdout);
const holdout = evalItems.filter((i) => i.holdout);

describe('moderation eval set', () => {
  it('covers every language and decision', () => {
    expect(tuned.length).toBeGreaterThanOrEqual(200);
    expect(holdout.length).toBeGreaterThanOrEqual(30);
    expect(new Set(evalItems.map((i) => i.lang))).toEqual(
      new Set(['en', 'ar', 'fr', 'arabizi', 'mixed']),
    );
    expect(new Set(evalItems.map((i) => i.expected))).toEqual(
      new Set(['approve', 'approve_redacted', 'reject', 'manual_review']),
    );
  });

  it('heuristic classifier stays above its baseline (tuned set)', async () => {
    const r = await evaluate(new HeuristicClassifier(), tuned);
    process.stdout.write(`${formatReport(r)}\n`);
    // the keyword lists were tuned on this part, so these are regression floors, not quality claims
    expect(r.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(r.heldBack.recall).toBeGreaterThanOrEqual(0.95);
    expect(r.heldBack.precision).toBeGreaterThanOrEqual(0.95);
    expect(r.piiRecall).toBeGreaterThanOrEqual(0.95);
  });

  it('reports the heuristic on the held-out items (never used for tuning)', async () => {
    const r = await evaluate(new HeuristicClassifier(), holdout);
    process.stdout.write(`${formatReport(r)}\n`);
    expect(r.total).toBe(holdout.length);
  });
});

describe.skipIf(!process.env.EVAL_LLM || !process.env.ANTHROPIC_API_KEY)(
  'moderation eval · Claude',
  () => {
    it(
      'reports precision / recall for the configured model',
      { timeout: 30 * 60_000 },
      async () => {
        const client = new Anthropic({ maxRetries: 4 });
        const model = process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
        const r = await evaluate(
          new ClaudeClassifier(
            { beta: { messages: { create: (p, o) => client.beta.messages.create(p, o) } } },
            model,
          ),
          evalItems,
          4,
        );
        process.stdout.write(`${formatReport(r)}\n`);
        expect(r.errors).toBe(0);
      },
    );
  },
);
