import { describe, it, expect } from 'vitest';

describe('commands/gate', () => {
  it('module exports commandGate', async () => {
    const mod = await import('../../src/commands/gate.js');
    expect(typeof mod.commandGate).toBe('function');
  });
});
