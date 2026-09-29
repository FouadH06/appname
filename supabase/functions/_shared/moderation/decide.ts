import { mergeSpans, redact, spansOf } from './rules.ts';
import type { ClassifyResult, Decision, RulesResult, Span, TextConfig } from './types.ts';

export interface DecisionResult {
  decision: Decision;
  textDisplay: string | null;
  piiSpans: Span[];
  reasons: string[];
  confidence: number | null;
}

/**
 * Decision matrix (Phase 3 Part 4 §3). Honest negative comments about the service are published;
 * only what harms people or the platform is held back:
 *   threat · hate · sexual harassment      → reject (the author may edit within 7 days)
 *   spam / advertising                      → reject
 *   insulting a person (severity ≥ 2)       → a human decides
 *   classifier unsure (< 0.70) or refused   → a human decides
 *   personal data only                      → published with it removed
 *   otherwise                               → approve
 */
export function decide(
  text: string,
  rules: RulesResult,
  c: ClassifyResult,
  cfg: TextConfig = {},
): DecisionResult {
  const confidenceMin = cfg.llm_confidence_min ?? 0.7;
  const severityMin = cfg.targeted_severity_min ?? 2;

  if (!c.ok) {
    return {
      decision: 'manual_review',
      textDisplay: null,
      piiSpans: rules.piiSpans,
      reasons: [`classifier_${c.reason}`, ...rules.flags],
      confidence: null,
    };
  }
  const v = c.value;
  const piiSpans = mergeSpans([...rules.piiSpans, ...spansOf(text, v.pii_values)]);
  const base = { piiSpans, confidence: v.confidence };

  const harms = [
    v.is_threat && 'threat',
    v.is_hate && 'hate',
    v.is_sexual_harassment && 'sexual_harassment',
  ].filter((x): x is string => !!x);
  if (harms.length) return { ...base, decision: 'reject', textDisplay: null, reasons: harms };

  const spam = v.is_spam || (rules.flags.includes('spam_phrase') && rules.flags.includes('link'));
  if (spam)
    return { ...base, decision: 'reject', textDisplay: null, reasons: ['spam', ...rules.flags] };

  if (v.target === 'person' && v.severity >= severityMin) {
    return { ...base, decision: 'manual_review', textDisplay: null, reasons: ['targeted_person'] };
  }
  if (v.confidence < confidenceMin) {
    return { ...base, decision: 'manual_review', textDisplay: null, reasons: ['low_confidence'] };
  }
  if (piiSpans.length || v.contains_pii) {
    if (!piiSpans.length) {
      // the model says there's personal data but we can't locate it: a human removes it
      return { ...base, decision: 'manual_review', textDisplay: null, reasons: ['pii_unlocated'] };
    }
    return {
      ...base,
      decision: 'approve_redacted',
      textDisplay: redact(text, piiSpans),
      reasons: ['pii'],
    };
  }
  return { ...base, decision: 'approve', textDisplay: null, reasons: rules.flags };
}
