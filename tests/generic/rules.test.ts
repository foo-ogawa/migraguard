import { describe, it, expect } from 'vitest';
import { pick, lint } from './helper.js';

describe('generic rules — MySQL', () => {
  const d = 'mysql' as const;

  describe('require-if-not-exists', () => {
    const rules = pick('require-if-not-exists');

    it('flags CREATE TABLE without IF NOT EXISTS', async () => {
      const v = await lint('CREATE TABLE users (id BIGINT PRIMARY KEY);', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('CREATE TABLE');
    });

    it('passes CREATE TABLE IF NOT EXISTS', async () => {
      const v = await lint('CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY);', rules, d);
      expect(v).toHaveLength(0);
    });

    it('flags DROP TABLE without IF EXISTS', async () => {
      const v = await lint('DROP TABLE users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('DROP');
    });

    it('passes DROP TABLE IF EXISTS', async () => {
      const v = await lint('DROP TABLE IF EXISTS users;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-drop-column', () => {
    const rules = pick('ban-drop-column');

    it('flags DROP COLUMN', async () => {
      const v = await lint('ALTER TABLE users DROP COLUMN email;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('email');
    });

    it('passes ADD COLUMN', async () => {
      const v = await lint('ALTER TABLE users ADD COLUMN phone VARCHAR(32);', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-alter-column-type', () => {
    const rules = pick('ban-alter-column-type');

    it('flags MODIFY COLUMN', async () => {
      const v = await lint('ALTER TABLE users MODIFY COLUMN name TEXT;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('ALTER COLUMN TYPE');
    });
  });

  describe('ban-rename-column', () => {
    const rules = pick('ban-rename-column');

    it('flags RENAME COLUMN', async () => {
      const v = await lint('ALTER TABLE users RENAME COLUMN old_name TO new_name;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('old_name');
      expect(v[0].message).toContain('new_name');
    });
  });

  describe('ban-rename-table', () => {
    const rules = pick('ban-rename-table');

    it('flags RENAME TO', async () => {
      const v = await lint('ALTER TABLE users RENAME TO accounts;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('users');
      expect(v[0].message).toContain('accounts');
    });
  });

  describe('ban-drop-table', () => {
    const rules = pick('ban-drop-table');

    it('flags DROP TABLE', async () => {
      const v = await lint('DROP TABLE IF EXISTS users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('DROP TABLE');
    });
  });

  describe('ban-update-without-where', () => {
    const rules = pick('ban-update-without-where');

    it('flags UPDATE without WHERE', async () => {
      const v = await lint("UPDATE users SET status = 'active';", rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('UPDATE');
    });

    it('passes UPDATE with WHERE', async () => {
      const v = await lint("UPDATE users SET status = 'active' WHERE id = 1;", rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-delete-without-where', () => {
    const rules = pick('ban-delete-without-where');

    it('flags DELETE without WHERE', async () => {
      const v = await lint('DELETE FROM users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('DELETE');
    });

    it('passes DELETE with WHERE', async () => {
      const v = await lint('DELETE FROM users WHERE id = 1;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-truncate', () => {
    const rules = pick('ban-truncate');

    it('flags TRUNCATE', async () => {
      const v = await lint('TRUNCATE TABLE users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('TRUNCATE');
    });
  });

  describe('adding-not-nullable-field', () => {
    const rules = pick('adding-not-nullable-field');

    it('flags NOT NULL without DEFAULT', async () => {
      const v = await lint('ALTER TABLE users ADD COLUMN age INT NOT NULL;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('NOT NULL');
    });

    it('passes NOT NULL with DEFAULT', async () => {
      const v = await lint('ALTER TABLE users ADD COLUMN age INT NOT NULL DEFAULT 0;', rules, d);
      expect(v).toHaveLength(0);
    });

    it('passes nullable column', async () => {
      const v = await lint('ALTER TABLE users ADD COLUMN age INT;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('require-create-or-replace-view', () => {
    const rules = pick('require-create-or-replace-view');

    it('flags CREATE VIEW without OR REPLACE', async () => {
      const v = await lint('CREATE VIEW user_emails AS SELECT id, email FROM users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('CREATE VIEW');
    });

    it('passes CREATE OR REPLACE VIEW', async () => {
      const v = await lint('CREATE OR REPLACE VIEW user_emails AS SELECT id, email FROM users;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-select-star-in-view', () => {
    const rules = pick('ban-select-star-in-view');

    it('flags SELECT * in VIEW', async () => {
      const v = await lint('CREATE OR REPLACE VIEW user_emails AS SELECT * FROM users;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('SELECT *');
    });

    it('passes explicit column list', async () => {
      const v = await lint('CREATE OR REPLACE VIEW user_emails AS SELECT id, email FROM users;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-drop-cascade', () => {
    const rules = pick('ban-drop-cascade');

    it('flags DROP TABLE CASCADE via regex', async () => {
      const v = await lint('DROP TABLE users CASCADE;', rules, d);
      expect(v).toHaveLength(1);
      expect(v[0].message).toContain('CASCADE');
    });

    it('passes DROP TABLE without CASCADE', async () => {
      const v = await lint('DROP TABLE IF EXISTS users;', rules, d);
      expect(v).toHaveLength(0);
    });
  });
});

describe('generic rules — SQLite', () => {
  const d = 'sqlite' as const;

  describe('require-if-not-exists', () => {
    const rules = pick('require-if-not-exists');

    it('flags CREATE TABLE without IF NOT EXISTS', async () => {
      const v = await lint('CREATE TABLE users (id INTEGER PRIMARY KEY);', rules, d);
      expect(v).toHaveLength(1);
    });

    it('passes CREATE TABLE IF NOT EXISTS', async () => {
      const v = await lint('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY);', rules, d);
      expect(v).toHaveLength(0);
    });

    it('flags CREATE INDEX without IF NOT EXISTS', async () => {
      const v = await lint('CREATE INDEX idx_email ON users (email);', rules, d);
      expect(v).toHaveLength(1);
    });

    it('passes CREATE INDEX IF NOT EXISTS', async () => {
      const v = await lint('CREATE INDEX IF NOT EXISTS idx_email ON users (email);', rules, d);
      expect(v).toHaveLength(0);
    });

    it('flags DROP TABLE without IF EXISTS', async () => {
      const v = await lint('DROP TABLE users;', rules, d);
      expect(v).toHaveLength(1);
    });

    it('passes DROP TABLE IF EXISTS', async () => {
      const v = await lint('DROP TABLE IF EXISTS users;', rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-drop-column', () => {
    const rules = pick('ban-drop-column');

    it('flags DROP COLUMN', async () => {
      const v = await lint('ALTER TABLE users DROP COLUMN email;', rules, d);
      expect(v).toHaveLength(1);
    });
  });

  describe('ban-rename-column', () => {
    const rules = pick('ban-rename-column');

    it('flags RENAME COLUMN', async () => {
      const v = await lint('ALTER TABLE users RENAME COLUMN old_name TO new_name;', rules, d);
      expect(v).toHaveLength(1);
    });
  });

  describe('ban-update-without-where', () => {
    const rules = pick('ban-update-without-where');

    it('flags UPDATE without WHERE', async () => {
      const v = await lint("UPDATE users SET status = 'active';", rules, d);
      expect(v).toHaveLength(1);
    });

    it('passes UPDATE with WHERE', async () => {
      const v = await lint("UPDATE users SET status = 'active' WHERE id = 1;", rules, d);
      expect(v).toHaveLength(0);
    });
  });

  describe('ban-delete-without-where', () => {
    const rules = pick('ban-delete-without-where');

    it('flags DELETE without WHERE', async () => {
      const v = await lint('DELETE FROM users;', rules, d);
      expect(v).toHaveLength(1);
    });
  });

  describe('ban-select-star-in-view', () => {
    const rules = pick('ban-select-star-in-view');

    it('flags SELECT * in VIEW', async () => {
      const v = await lint('CREATE VIEW IF NOT EXISTS emails AS SELECT * FROM users;', rules, d);
      expect(v).toHaveLength(1);
    });
  });

  describe('adding-not-nullable-field', () => {
    const rules = pick('adding-not-nullable-field');

    it('flags NOT NULL without DEFAULT', async () => {
      const v = await lint('ALTER TABLE users ADD COLUMN age INTEGER NOT NULL;', rules, d);
      expect(v).toHaveLength(1);
    });

    it('passes NOT NULL with DEFAULT', async () => {
      const v = await lint("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';", rules, d);
      expect(v).toHaveLength(0);
    });
  });
});
