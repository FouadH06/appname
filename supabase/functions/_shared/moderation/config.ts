import {
  ClaudeClassifier,
  ClaudeTranslator,
  DEFAULT_LLM_MODEL,
  HeuristicClassifier,
  LocalEchoTranslator,
  type ClaudeClient,
} from './classifier.ts';
import type { TextClassifier, Translator } from './types.ts';

export type Env = (name: string) => string | undefined;

export interface ModerationConfig {
  mode: 'llm' | 'heuristic';
  classifier: TextClassifier;
  translator?: Translator;
  /** may a comment be published without a moderator? */
  autoPublish: boolean;
}

/** The local stack (edge runtime → kong) or a developer machine; anything else counts as hosted. */
export function isLocalStack(supabaseUrl: string | undefined): boolean {
  return /^https?:\/\/(kong|localhost|127\.0\.0\.1|host\.docker\.internal)(:|\/|$)/.test(
    supabaseUrl ?? '',
  );
}

/**
 * Model: MODERATION_MODE=llm (default when ANTHROPIC_API_KEY is set) uses Claude (LLM_MODEL, default
 * claude-sonnet-5) for classification and translations; otherwise the keyword classifier.
 *
 * Auto-publication (PO decision 2026-09-29):
 *  - keyword classifier: only on the local stack. Hosted/staging/production: strict — explicit
 *    rejects still reject, every other comment goes to a moderator.
 *  - Claude: only with MODERATION_AUTO_PUBLISH=true, set once the chosen model meets the safety
 *    target on the expanded blind eval (0 harmful held-out comments published). Until then Claude's
 *    approvals go to a moderator too (its rejects and hand-offs apply).
 * Star ratings are unaffected (their own fraud rules). Translations: Claude, or a marked echo locally.
 */
export function moderationConfigFromEnv(
  env: Env,
  makeClient: (apiKey: string) => ClaudeClient,
): ModerationConfig {
  const key = env('ANTHROPIC_API_KEY');
  const local = isLocalStack(env('SUPABASE_URL'));
  const wantLlm = (env('MODERATION_MODE') ?? (key ? 'llm' : 'heuristic')) === 'llm';
  if (wantLlm && key) {
    const client = makeClient(key);
    const model = env('LLM_MODEL') || DEFAULT_LLM_MODEL;
    return {
      mode: 'llm',
      classifier: new ClaudeClassifier(client, model),
      translator: new ClaudeTranslator(client, model),
      autoPublish: env('MODERATION_AUTO_PUBLISH') === 'true',
    };
  }
  return {
    mode: 'heuristic',
    classifier: new HeuristicClassifier(!local),
    translator: local ? new LocalEchoTranslator() : undefined,
    autoPublish: local,
  };
}
