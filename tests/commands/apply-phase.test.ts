import { describe, it, expect } from 'vitest';

describe('commands/apply-phase', () => {
  it('module exports commandApplyPhase', async () => {
    const mod = await import('../../src/commands/apply-phase.js');
    expect(typeof mod.commandApplyPhase).toBe('function');
  });
});
