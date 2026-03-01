import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/config.js';
import { MigraguardDb } from '../src/db.js';

describe('db', () => {
  it('creates MigraguardDb instance with config', () => {
    const config = buildConfig({
      connection: {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
        user: 'test_user',
      },
    }, '/tmp');
    const db = new MigraguardDb(config);
    expect(db).toBeDefined();
    expect(db.getClient()).toBeDefined();
  });

  it('getClient returns the underlying pg.Client', () => {
    const config = buildConfig({}, '/tmp');
    const db = new MigraguardDb(config);
    const client = db.getClient();
    expect(client).toBeDefined();
  });
});
