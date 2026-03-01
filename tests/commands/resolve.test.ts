import { describe, it, expect } from 'vitest';

describe('commands/resolve', () => {
  it('module exports commandResolve', async () => {
    const mod = await import('../../src/commands/resolve.js');
    expect(typeof mod.commandResolve).toBe('function');
  });
});
