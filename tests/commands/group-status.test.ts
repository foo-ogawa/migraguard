import { describe, it, expect } from 'vitest';

describe('commands/group-status', () => {
  it('module exports commandGroupStatus', async () => {
    const mod = await import('../../src/commands/group-status.js');
    expect(typeof mod.commandGroupStatus).toBe('function');
  });
});
