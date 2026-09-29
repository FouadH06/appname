// Text moderation (M9) — shared types. Reviews and replies go through the same pipeline:
// rules → normalize → classifier → decision (Phase 3 Part 4 §3).

export type Subject = 'review_text' | 'reply_text';
export type Lang = 'ar' | 'en' | 'fr' | 'arabizi';
export type Decision = 'approve' | 'approve_redacted' | 'reject' | 'manual_review';

export interface Span {
  start: number;
  end: number;
  kind: 'url' | 'email' | 'phone' | 'handle';
}

export interface RulesResult {
  piiSpans: Span[];
  /** link · spam_phrase · repeat_chars */
  flags: string[];
}

export interface Classification {
  /** e.g. service_quality, staff_behaviour, hygiene, price, wait_time, harassment, off_topic */
  categories: string[];
  /** who the negative part is about */
  target: 'service' | 'business' | 'person' | 'none';
  /** 0 none · 1 mild · 2 insulting · 3 severe */
  severity: 0 | 1 | 2 | 3;
  contains_pii: boolean;
  /** exact substrings of the text that are personal data (phone, email, handle, full name of a private person) */
  pii_values: string[];
  is_spam: boolean;
  is_threat: boolean;
  is_hate: boolean;
  is_sexual_harassment: boolean;
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  confidence: number;
}

export interface ClassifyInput {
  subject: Subject;
  text: string;
  /** Arabic-script approximation of Arabizi words, when the text has any */
  arabiziHint: string | null;
  langs: Lang[];
  context: JobContext;
}

export type ClassifyResult =
  | { ok: true; value: Classification; model: string; latencyMs: number }
  /** refusal / invalid → a human decides; error → temporary, the job is retried */
  | {
      ok: false;
      reason: 'refusal' | 'invalid' | 'error';
      detail: string;
      model: string;
      latencyMs: number;
    };

export interface TextClassifier {
  readonly name: string;
  classify(input: ClassifyInput): Promise<ClassifyResult>;
}

export interface Translator {
  readonly model: string;
  translate(
    text: string,
    target: 'en' | 'ar' | 'fr',
  ): Promise<{ text: string; sourceLangs: string[] }>;
}

export interface JobContext {
  business?: string;
  service?: string;
  staff?: string;
  /** first names of the business's team (a comment naming them is "about a person") */
  people?: string[];
  /** for replies: the review being answered */
  reply_to?: string | null;
}

export interface TextConfig {
  llm_confidence_min?: number;
  targeted_severity_min?: number;
}

export interface ModerationJob {
  msg_id: number;
  subject: Subject;
  id: string;
  run_id: string;
  attempt: number;
  text: string;
  text_hash: string;
  locale: string;
  config: TextConfig;
  context: JobContext;
}

export interface StageResult {
  stage: 'text_rules' | 'text_normalize' | 'text_llm' | 'decision';
  outcome: 'pass' | 'flag' | 'fail' | 'error' | 'skip';
  scores?: Record<string, unknown>;
  labels?: string[];
  model?: string;
  latency_ms?: number;
}

export interface ModerationRecord {
  job: ModerationJob;
  decision: Decision;
  textDisplay: string | null;
  stages: StageResult[];
  normalized: string;
  piiSpans: Span[];
  classifier: Classification | null;
  langs: Lang[];
  confidence: number | null;
  reasons: string[];
}

export interface TranslationJob {
  msg_id: number;
  subject_type: 'review' | 'reply';
  id: string;
  locale: 'en' | 'ar' | 'fr';
  text: string;
}

export interface ModerationStore {
  claim(limit: number): Promise<ModerationJob[]>;
  record(r: ModerationRecord): Promise<string>;
  claimTranslations(limit: number): Promise<TranslationJob[]>;
  recordTranslation(
    job: TranslationJob,
    text: string,
    sourceLangs: string[],
    model: string,
  ): Promise<void>;
}
