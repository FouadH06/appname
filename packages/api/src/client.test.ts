import { describe, expect, it } from 'vitest';
import { createAppClient } from './client';

describe('createAppClient', () => {
  it('requires url and key', () => {
    expect(() => createAppClient({ url: '', anonKey: 'x' })).toThrow();
    expect(() => createAppClient({ url: 'http://127.0.0.1:54321', anonKey: '' })).toThrow();
  });

  it('creates a client for the local stack', () => {
    const client = createAppClient({ url: 'http://127.0.0.1:54321', anonKey: 'test-key' });
    expect(typeof client.rpc).toBe('function');
  });
});
