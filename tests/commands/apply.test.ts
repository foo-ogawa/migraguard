import { describe, it, expect } from 'vitest';

describe('commands/apply', () => {
  it('module exports commandApply', async () => {
    const mod = await import('../../src/commands/apply.js');
    expect(typeof mod.commandApply).toBe('function');
  });

  // Integration tests with real DB are in tests/integration/apply.test.ts
  // Unit-level logic verification is done through the integration tests
  // since apply depends heavily on DB + psql
});
