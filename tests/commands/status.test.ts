import { describe, it, expect } from 'vitest';

describe('commands/status', () => {
  it('module exports commandStatus', async () => {
    const mod = await import('../../src/commands/status.js');
    expect(typeof mod.commandStatus).toBe('function');
  });
});
