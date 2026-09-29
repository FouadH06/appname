import type { ImageClassifyResult } from './classifier.ts';

// Image decision (Phase 3 Part 4 §3.2), after validation / sanitize / hash ran in the worker + DB:
//   safety ≥ hard → reject · ≥ grey → human
//   document / ID → human · contact details or QR → reject
//   customer results: minors → human (+ minor flag) · relevance < 0.40 reject · < 0.75 human · else approve
//   classifier refused / unusable → human
// Nothing is ever published without either a validated classifier (MEDIA_AUTO_PUBLISH) or a moderator.

export interface MediaConfig {
  relevance_reject?: number;
  relevance_pass?: number;
  safety_hard?: number;
  safety_grey?: number;
}

export interface ImageDecision {
  decision: 'approve' | 'manual_review' | 'reject';
  reasons: string[];
  /** customer-facing category for rejections */
  reasonCode: string | null;
  minor: boolean;
}

export function decideImage(
  subject: 'review_media' | 'business_media',
  c: ImageClassifyResult,
  cfg: MediaConfig = {},
  autoPublish = false,
): ImageDecision {
  const hard = cfg.safety_hard ?? 0.85;
  const grey = cfg.safety_grey ?? 0.4;
  const relReject = cfg.relevance_reject ?? 0.4;
  const relPass = cfg.relevance_pass ?? 0.75;
  const human = (reasons: string[], minor = false): ImageDecision => ({
    decision: 'manual_review',
    reasons,
    reasonCode: null,
    minor,
  });
  const reject = (reasons: string[], reasonCode: string): ImageDecision => ({
    decision: 'reject',
    reasons,
    reasonCode,
    minor: false,
  });

  if (!c.ok) return human([`classifier_${c.reason}`]);
  const v = c.value;
  const worst = Math.max(v.safety.sexual, v.safety.violence, v.safety.hate_symbols);
  if (worst >= hard) return reject(['safety'], 'guidelines');
  if (worst >= grey) return human(['safety_grey']);
  if (v.ocr.document_or_id) return human(['document']);
  if (v.ocr.contact_info || v.ocr.qr_code) return reject(['contact_info'], 'contact_info');

  if (subject === 'business_media') {
    // already public; the check only removes or escalates
    return { decision: 'approve', reasons: [], reasonCode: null, minor: false };
  }
  if (v.minors_present) return human(['minor'], true);
  const rel = v.relevance ?? 0;
  if (rel < relReject) return reject(['not_relevant'], 'not_relevant');
  if (rel < relPass) return human(['relevance_unsure']);
  if (!autoPublish) return human(['auto_publish_off']);
  return { decision: 'approve', reasons: [], reasonCode: null, minor: false };
}
