import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError, parseEnv } from './env';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

describe('parseEnv', () => {
  it('returns typed values when valid', () => {
    const env = parseEnv(schema, {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: 'key',
    });
    expect(env.SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('lists every invalid key', () => {
    expect(() => parseEnv(schema, { SUPABASE_URL: 'not-a-url' })).toThrowError(EnvValidationError);
    try {
      parseEnv(schema, { SUPABASE_URL: 'not-a-url' });
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join('\n');
      expect(issues).toContain('SUPABASE_URL');
      expect(issues).toContain('SUPABASE_ANON_KEY');
    }
  });
});
