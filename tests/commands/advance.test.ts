import { describe, it, expect } from 'vitest';

describe('commands/advance', () => {
  it('module exports commandAdvance', async () => {
    const mod = await import('../../src/commands/advance.js');
    expect(typeof mod.commandAdvance).toBe('function');
  });
});
