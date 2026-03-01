import { describe, it, expect } from 'vitest';

describe('commands/dump', () => {
  it('module exports commandDump', async () => {
    const mod = await import('../../src/commands/dump.js');
    expect(typeof mod.commandDump).toBe('function');
  });
});
