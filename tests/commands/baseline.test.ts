import { describe, it, expect } from 'vitest';

describe('commands/baseline', () => {
  it('module exports commandBaseline', async () => {
    const mod = await import('../../src/commands/baseline.js');
    expect(typeof mod.commandBaseline).toBe('function');
  });
});
