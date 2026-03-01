import { describe, it, expect } from 'vitest';
import { isPsqlAvailable } from '../src/psql.js';

describe('psql', () => {
  it('isPsqlAvailable returns boolean', async () => {
    const result = await isPsqlAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('isPsqlAvailable returns false with empty PATH', async () => {
    const origPath = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      const result = await isPsqlAvailable();
      expect(result).toBe(false);
    } finally {
      process.env['PATH'] = origPath;
    }
  });
});
