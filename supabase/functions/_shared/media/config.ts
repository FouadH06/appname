import { DEFAULT_LLM_MODEL } from '../moderation/classifier.ts';
import { isLocalStack } from '../moderation/config.ts';
import {
  ClaudeImageClassifier,
  LocalImageClassifier,
  NoImageClassifier,
  type ClaudeImageClient,
  type ImageClassifier,
} from './classifier.ts';

export type Env = (name: string) => string | undefined;

export interface MediaModerationConfig {
  mode: 'llm' | 'local' | 'none';
  classifier: ImageClassifier;
  /** may a customer photo be published without a moderator? */
  autoPublish: boolean;
}

/**
 * Same principle as text (PO decision 2026-09-29): nothing is published automatically without a
 * validated classifier.
 *  - local stack: stub classifier, auto-publication on (so the flow can be exercised end to end)
 *  - hosted with ANTHROPIC_API_KEY: Claude vision (MEDIA_LLM_MODEL → LLM_MODEL → claude-sonnet-5);
 *    auto-publication only with MEDIA_AUTO_PUBLISH=true, set after the labeled image eval passes
 *    (≥ 90 % correct, 0 harmful images published); otherwise approvals wait for a moderator
 *  - hosted without a key: every image goes to a moderator
 */
export function mediaConfigFromEnv(
  env: Env,
  makeClient: (apiKey: string) => ClaudeImageClient,
): MediaModerationConfig {
  if (isLocalStack(env('SUPABASE_URL')))
    return { mode: 'local', classifier: new LocalImageClassifier(), autoPublish: true };
  const key = env('ANTHROPIC_API_KEY');
  if (!key) return { mode: 'none', classifier: new NoImageClassifier(), autoPublish: false };
  const model = env('MEDIA_LLM_MODEL') || env('LLM_MODEL') || DEFAULT_LLM_MODEL;
  return {
    mode: 'llm',
    classifier: new ClaudeImageClassifier(makeClient(key), model),
    autoPublish: env('MEDIA_AUTO_PUBLISH') === 'true',
  };
}
