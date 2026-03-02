import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { VERSION } from '../src/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

describe('migraguard', () => {
  it('exports VERSION matching package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
});
