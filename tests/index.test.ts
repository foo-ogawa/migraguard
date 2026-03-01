import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('migraguard', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });
});
