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
}

/**
 * MODERATION_MODE=llm (default when ANTHROPIC_API_KEY is set) uses Claude (model LLM_MODEL, default
 * claude-opus-5) for classification and translations. MODERATION_MODE=heuristic — or no key —
 * uses the keyword classifier: locally/CI as is; on a hosted project in strict mode (it may reject or
 * redact, but every other comment waits for a moderator). Translations are then only available
 * locally (a marked echo), never on a hosted project.
 */
export function moderationConfigFromEnv(
  env: Env,
  makeClient: (apiKey: string) => ClaudeClient,
): ModerationConfig {
  const key = env('ANTHROPIC_API_KEY');
  const wantLlm = (env('MODERATION_MODE') ?? (key ? 'llm' : 'heuristic')) === 'llm';
  if (wantLlm && key) {
    const client = makeClient(key);
    const model = env('LLM_MODEL') || DEFAULT_LLM_MODEL;
    return {
      mode: 'llm',
      classifier: new ClaudeClassifier(client, model),
      translator: new ClaudeTranslator(client, model),
    };
  }
  const hosted = /\.supabase\.co/.test(env('SUPABASE_URL') ?? '');
  return {
    mode: 'heuristic',
    // hosted without an LLM: strict (every comment not rejected goes to a human)
    classifier: new HeuristicClassifier(hosted),
    translator: hosted ? undefined : new LocalEchoTranslator(),
  };
}
