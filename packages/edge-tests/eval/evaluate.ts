import { decide } from '../../../supabase/functions/_shared/moderation/decide.ts';
import {
  arabiziToArabic,
  detectLangs,
} from '../../../supabase/functions/_shared/moderation/normalize.ts';
import { applyRules } from '../../../supabase/functions/_shared/moderation/rules.ts';
import type {
  Decision,
  TextClassifier,
} from '../../../supabase/functions/_shared/moderation/types.ts';
import set from './moderation-set.json' with { type: 'json' };

// Scores a classifier + the decision matrix against the labelled set (scripts/moderation-eval-set.py).
// "Held back" = reject or manual review (not published as written). The costly errors:
//   harmful published  — expected reject/manual, got approve(_redacted)
//   benign held back   — expected approve(_redacted), got reject/manual (a human or the author fixes it)

export interface EvalItem {
  id: string;
  category: string;
  lang: string;
  expected: Decision;
  text: string;
  holdout?: boolean;
}

export interface EvalReport {
  classifier: string;
  total: number;
  accuracy: number;
  heldBack: { precision: number; recall: number };
  harmfulPublished: EvalItem[];
  benignHeldBack: EvalItem[];
  piiRecall: number;
  byLang: Record<string, number>;
  confusion: Record<Decision, Record<Decision, number>>;
  errors: number;
  mistakes: (EvalItem & { got: Decision })[];
}

const DECISIONS: Decision[] = ['approve', 'approve_redacted', 'reject', 'manual_review'];
const held = (d: Decision) => d === 'reject' || d === 'manual_review';
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : 1);

export const evalItems = set.items as EvalItem[];

export async function evaluate(
  classifier: TextClassifier,
  items: EvalItem[] = evalItems,
  concurrency = 4,
): Promise<EvalReport> {
  const got: (Decision | null)[] = new Array(items.length).fill(null);
  let next = 0;
  let errors = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i]!;
      const langs = detectLangs(it.text);
      const c = await classifier.classify({
        subject: 'review_text',
        text: it.text,
        arabiziHint: langs.includes('arabizi') ? arabiziToArabic(it.text) : null,
        langs,
        context: { business: 'Test Salon', service: 'Haircut', staff: 'Karim', people: set.people },
      });
      if (!c.ok && c.reason === 'error') errors += 1;
      got[i] = decide(it.text, applyRules(it.text), c).decision;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const confusion = Object.fromEntries(
    DECISIONS.map((e) => [e, Object.fromEntries(DECISIONS.map((g) => [g, 0]))]),
  ) as EvalReport['confusion'];
  const byLangHits: Record<string, [number, number]> = {};
  let hits = 0;
  let tpHeld = 0;
  let predHeld = 0;
  let actualHeld = 0;
  let pii = 0;
  let piiHits = 0;
  const harmfulPublished: EvalItem[] = [];
  const benignHeldBack: EvalItem[] = [];
  const mistakes: (EvalItem & { got: Decision })[] = [];
  items.forEach((it, i) => {
    const g = got[i]!;
    confusion[it.expected][g] += 1;
    const ok = g === it.expected;
    hits += ok ? 1 : 0;
    const l = (byLangHits[it.lang] ??= [0, 0]);
    l[0] += ok ? 1 : 0;
    l[1] += 1;
    if (held(g)) predHeld += 1;
    if (held(it.expected)) actualHeld += 1;
    if (held(g) && held(it.expected)) tpHeld += 1;
    if (held(it.expected) && !held(g)) harmfulPublished.push(it);
    if (!held(it.expected) && held(g)) benignHeldBack.push(it);
    if (it.expected === 'approve_redacted') {
      pii += 1;
      piiHits += g === 'approve_redacted' ? 1 : 0;
    }
    if (!ok) mistakes.push({ ...it, got: g });
  });
  return {
    classifier: classifier.name,
    total: items.length,
    accuracy: ratio(hits, items.length),
    heldBack: { precision: ratio(tpHeld, predHeld), recall: ratio(tpHeld, actualHeld) },
    harmfulPublished,
    benignHeldBack,
    piiRecall: ratio(piiHits, pii),
    byLang: Object.fromEntries(Object.entries(byLangHits).map(([k, [a, b]]) => [k, ratio(a, b)])),
    confusion,
    errors,
    mistakes,
  };
}

export function formatReport(r: EvalReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `Moderation eval · ${r.classifier} · ${r.total} items${r.errors ? ` · ${r.errors} classifier errors` : ''}`,
    `  exact decision accuracy   ${pct(r.accuracy)}`,
    `  held back  precision      ${pct(r.heldBack.precision)}   recall ${pct(r.heldBack.recall)}`,
    `  personal data redacted    ${pct(r.piiRecall)}`,
    `  harmful published         ${r.harmfulPublished.length}`,
    `  benign held back          ${r.benignHeldBack.length}`,
    `  by language               ${Object.entries(r.byLang)
      .map(([k, v]) => `${k} ${pct(v)}`)
      .join(' · ')}`,
    '  confusion (expected → got: approve / redacted / reject / manual)',
    ...Object.entries(r.confusion).map(
      ([e, row]) =>
        `    ${e.padEnd(17)} ${Object.values(row)
          .map((n) => String(n).padStart(4))
          .join('')}`,
    ),
  ];
  if (r.mistakes.length) {
    lines.push('  mistakes:');
    for (const m of r.mistakes)
      lines.push(`    ${m.id} [${m.lang}] expected ${m.expected}, got ${m.got}: ${m.text}`);
  }
  return lines.join('\n');
}
