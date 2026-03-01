import { describe, it, expect } from 'vitest';

describe('commands/diff', () => {
  it('module exports commandDiff', async () => {
    const mod = await import('../../src/commands/diff.js');
    expect(typeof mod.commandDiff).toBe('function');
  });
});
