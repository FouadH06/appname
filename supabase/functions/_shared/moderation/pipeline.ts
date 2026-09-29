import { rpc } from '../otp/store.ts';
import type { Fetch } from '../otp/types.ts';
import { decide } from './decide.ts';
import { arabiziToArabic, detectLangs, normalizeText } from './normalize.ts';
import { applyRules } from './rules.ts';
import type {
  ModerationJob,
  ModerationRecord,
  ModerationStore,
  StageResult,
  TextClassifier,
  TranslationJob,
  Translator,
} from './types.ts';

/** Runs one text through rules → normalize → classifier → decision. Null = temporary failure (retry later). */
export async function moderateText(
  job: ModerationJob,
  classifier: TextClassifier,
): Promise<ModerationRecord | null> {
  const stages: StageResult[] = [];
  const rules = applyRules(job.text);
  stages.push({
    stage: 'text_rules',
    outcome: rules.piiSpans.length || rules.flags.length ? 'flag' : 'pass',
    labels: [...new Set([...rules.flags, ...rules.piiSpans.map((s) => s.kind)])],
  });

  const normalized = normalizeText(job.text);
  const langs = detectLangs(job.text);
  const arabiziHint = langs.includes('arabizi') ? arabiziToArabic(job.text) : null;
  stages.push({ stage: 'text_normalize', outcome: 'pass', labels: langs });

  const c = await classifier.classify({
    subject: job.subject,
    text: job.text,
    arabiziHint,
    langs,
    context: job.context,
  });
  if (!c.ok && c.reason === 'error') return null;
  stages.push({
    stage: 'text_llm',
    outcome: c.ok ? 'pass' : 'error',
    model: c.model,
    latency_ms: c.latencyMs,
    labels: c.ok ? c.value.categories : [c.reason],
    scores: c.ok
      ? {
          severity: c.value.severity,
          confidence: c.value.confidence,
          target: c.value.target,
          sentiment: c.value.sentiment,
        }
      : {},
  });

  const d = decide(job.text, rules, c, job.config);
  stages.push({
    stage: 'decision',
    outcome: d.decision === 'approve' ? 'pass' : d.decision === 'reject' ? 'fail' : 'flag',
    labels: d.reasons,
  });

  return {
    job,
    decision: d.decision,
    textDisplay: d.textDisplay,
    stages,
    normalized,
    piiSpans: d.piiSpans,
    classifier: c.ok ? c.value : null,
    langs,
    confidence: d.confidence,
    reasons: d.reasons,
  };
}

export interface WorkerSummary {
  claimed: number;
  decided: Record<string, number>;
  retry: number;
  translated: number;
  translate_failed: number;
}

export interface WorkerDeps {
  store: ModerationStore;
  classifier: TextClassifier;
  translator?: Translator;
  limit?: number;
  log?: (line: string) => void;
}

/** One worker run: the moderation queue, then pending translations. */
export async function runModeration(deps: WorkerDeps): Promise<WorkerSummary> {
  const summary: WorkerSummary = {
    claimed: 0,
    decided: {},
    retry: 0,
    translated: 0,
    translate_failed: 0,
  };
  const jobs = await deps.store.claim(deps.limit ?? 20);
  summary.claimed = jobs.length;
  for (const job of jobs) {
    try {
      const rec = await moderateText(job, deps.classifier);
      if (!rec) {
        summary.retry += 1; // stays in the queue; visible again after the timeout
        continue;
      }
      const result = await deps.store.record(rec);
      summary.decided[result] = (summary.decided[result] ?? 0) + 1;
    } catch (e) {
      summary.retry += 1;
      deps.log?.(
        `moderate: ${job.subject} ${job.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (deps.translator) {
    for (const t of await deps.store.claimTranslations(deps.limit ?? 20)) {
      try {
        const out = await deps.translator.translate(t.text, t.locale);
        await deps.store.recordTranslation(t, out.text, out.sourceLangs, deps.translator.model);
        summary.translated += 1;
      } catch (e) {
        summary.translate_failed += 1;
        deps.log?.(
          `translate: ${t.subject_type} ${t.id} failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  if (summary.claimed || summary.translated || summary.translate_failed)
    deps.log?.(`moderate: ${JSON.stringify(summary)}`);
  return summary;
}

export function postgrestModerationStore(
  url: string,
  key: string,
  fetchFn: Fetch = fetch,
): ModerationStore {
  return {
    claim: (limit) =>
      rpc<ModerationJob[]>(fetchFn, url, key, 'moderation_claim', { p_limit: limit, p_vt: 120 }),
    record: (r) =>
      rpc<string>(fetchFn, url, key, 'moderation_record', {
        p_msg_id: r.job.msg_id,
        p_subject: r.job.subject,
        p_id: r.job.id,
        p_run_id: r.job.run_id,
        p_text_hash: r.job.text_hash,
        p_decision: r.decision,
        p_text_display: r.textDisplay,
        p_stages: r.stages,
        p_normalized: r.normalized,
        p_pii_spans: r.piiSpans,
        p_classifier: r.classifier,
        p_langs: r.langs,
        p_confidence: r.confidence,
        p_reasons: r.reasons,
      }),
    claimTranslations: (limit) =>
      rpc<TranslationJob[]>(fetchFn, url, key, 'translation_claim', { p_limit: limit, p_vt: 120 }),
    recordTranslation: async (t, text, sourceLangs, model) => {
      await rpc(fetchFn, url, key, 'translation_record', {
        p_msg_id: t.msg_id,
        p_subject_type: t.subject_type,
        p_subject_id: t.id,
        p_locale: t.locale,
        p_text: text,
        p_source_langs: sourceLangs,
        p_model: model,
      });
    },
  };
}
