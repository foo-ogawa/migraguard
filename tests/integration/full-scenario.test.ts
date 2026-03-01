/**
 * 統合テスト: アジャイル開発フロー + ライフサイクル検証
 *
 * 単一ファイルで順次実行し、DB 競合を防止する。
 * 各 describe ブロックの beforeEach で DB をリセットする。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { checksumString } from '../../src/checksum.js';
import { saveMetadata } from '../../src/metadata.js';
import { scanMigrations } from '../../src/scanner.js';
import { commandCheck } from '../../src/commands/check.js';
import { commandSquash } from '../../src/commands/squash.js';
import { commandApply } from '../../src/commands/apply.js';
import { commandStatus } from '../../src/commands/status.js';
import { commandEditable } from '../../src/commands/editable.js';
import { commandResolve } from '../../src/commands/resolve.js';
import { commandDump } from '../../src/commands/dump.js';
import { commandDiff } from '../../src/commands/diff.js';
import { resolveFromConfig } from '../../src/config.js';
import {
  resetTestDb,
  queryTestDb,
  createTestProject,
  writeMigration,
  cleanupTestProject,
} from './helpers.js';
import type { TestProject } from './helpers.js';

// ─────────────────────────────────────────────
// アジャイル開発シナリオ
// ─────────────────────────────────────────────

describe('agile scenario', () => {
  let project: TestProject;

  afterAll(async () => {
    if (project) await cleanupTestProject(project);
  });

  beforeEach(async () => {
    if (project) await cleanupTestProject(project);
    await resetTestDb();
    project = await createTestProject();
  });

  it('Sprint 1: ユーザ管理 — new → squash → check → apply → status', async () => {
    await writeMigration(project, '20260301_100000__create_users_table.sql', `
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
`);

    await writeMigration(project, '20260301_110000__create_sessions_table.sql', `
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(512) NOT NULL UNIQUE,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (token);
`);

    // check → squash 強制
    const c1 = await commandCheck(project.config);
    expect(c1.ok).toBe(false);

    await commandSquash(project.config);
    const files = await scanMigrations(project.config);
    expect(files).toHaveLength(1);

    const c2 = await commandCheck(project.config);
    expect(c2.ok).toBe(true);

    const ap = await commandApply(project.config);
    expect(ap.errors).toHaveLength(0);
    expect(ap.applied).toHaveLength(1);

    const tables = await queryTestDb(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const names = tables.rows.map((r: Record<string, unknown>) => r['tablename']);
    expect(names).toContain('users');
    expect(names).toContain('sessions');

    const st = await commandStatus(project.config);
    expect(st.entries[0].status).toBe('applied');

    const ed = await commandEditable(project.config);
    expect(ed.editableFiles).toHaveLength(1);
  });

  it('Sprint 2: SNS フォロー機能', async () => {
    // Sprint 1 ベース
    const s1 = `
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
    await writeMigration(project, '20260301_110000__sprint1.sql', s1);
    await saveMetadata(project.config, {
      migrations: [{ file: '20260301_110000__sprint1.sql', checksum: checksumString(s1) }],
    });
    await commandApply(project.config);

    // Sprint 2
    await writeMigration(project, '20260308_100000__create_follows.sql', `
CREATE TABLE IF NOT EXISTS follows (
    follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee_id);
`);
    await writeMigration(project, '20260308_110000__add_user_bio.sql', `
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website VARCHAR(512);
`);

    await commandSquash(project.config);

    const c = await commandCheck(project.config);
    expect(c.ok).toBe(true);

    const ap = await commandApply(project.config);
    expect(ap.errors).toHaveLength(0);
    expect(ap.applied).toHaveLength(1);

    const bio = await queryTestDb(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='bio'",
    );
    expect(bio.rows).toHaveLength(1);

    const st = await commandStatus(project.config);
    expect(st.entries.filter(e => e.status === 'applied')).toHaveLength(2);
  });

  it('Sprint 3: チャットルーム', async () => {
    const base = `
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
    await writeMigration(project, '20260301_100000__base.sql', base);
    await saveMetadata(project.config, {
      migrations: [{ file: '20260301_100000__base.sql', checksum: checksumString(base) }],
    });
    await commandApply(project.config);

    await writeMigration(project, '20260315_100000__create_chat_rooms.sql', `
CREATE TABLE IF NOT EXISTS chat_rooms (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    room_type VARCHAR(20) NOT NULL DEFAULT 'group',
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_room_members (
    room_id BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (room_id, user_id)
);
`);
    await writeMigration(project, '20260315_110000__create_chat_messages.sql', `
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages (room_id, created_at DESC);
`);

    await commandSquash(project.config);
    const c = await commandCheck(project.config);
    expect(c.ok).toBe(true);

    const ap = await commandApply(project.config);
    expect(ap.errors).toHaveLength(0);

    const tables = await queryTestDb(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const names = tables.rows.map((r: Record<string, unknown>) => r['tablename']);
    expect(names).toContain('chat_rooms');
    expect(names).toContain('chat_room_members');
    expect(names).toContain('chat_messages');
  });

  it('Sprint 4: DM + 既読管理', async () => {
    const base = `
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_rooms (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    room_type VARCHAR(20) NOT NULL DEFAULT 'group',
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
    await writeMigration(project, '20260315_100000__base_chat.sql', base);
    await saveMetadata(project.config, {
      migrations: [{ file: '20260315_100000__base_chat.sql', checksum: checksumString(base) }],
    });
    await commandApply(project.config);

    await writeMigration(project, '20260322_100000__create_dm_and_receipts.sql', `
CREATE TABLE IF NOT EXISTS direct_messages (
    id BIGSERIAL PRIMARY KEY,
    room_id BIGINT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    sender_id BIGINT NOT NULL REFERENCES users(id),
    recipient_id BIGINT NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages (recipient_id, is_read);

CREATE TABLE IF NOT EXISTS message_read_receipts (
    message_id BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, user_id)
);
`);

    const c = await commandCheck(project.config);
    expect(c.ok).toBe(true);

    const ap = await commandApply(project.config);
    expect(ap.errors).toHaveLength(0);
    expect(ap.applied).toHaveLength(1);

    const tables = await queryTestDb(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    );
    const names = tables.rows.map((r: Record<string, unknown>) => r['tablename']);
    expect(names).toContain('direct_messages');
    expect(names).toContain('message_read_receipts');

    // 再適用 → 冪等
    const ap2 = await commandApply(project.config);
    expect(ap2.applied).toHaveLength(0);
    expect(ap2.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// ライフサイクル検証
// ─────────────────────────────────────────────

describe('lifecycle', () => {
  let project: TestProject;

  afterAll(async () => {
    if (project) await cleanupTestProject(project);
  });

  beforeEach(async () => {
    if (project) await cleanupTestProject(project);
    await resetTestDb();
    project = await createTestProject();
  });

  it('applies and re-runs idempotently', async () => {
    await writeMigration(project, '20260401_100000__test.sql',
      'CREATE TABLE IF NOT EXISTS idem_test (id SERIAL PRIMARY KEY);');

    const r1 = await commandApply(project.config);
    expect(r1.applied).toHaveLength(1);

    const r2 = await commandApply(project.config);
    expect(r2.applied).toHaveLength(0);
  });

  it('re-applies latest file when checksum changes', async () => {
    await writeMigration(project, '20260401_100000__reapply.sql',
      'CREATE TABLE IF NOT EXISTS reapply_test (id SERIAL PRIMARY KEY);');
    await commandApply(project.config);

    await writeMigration(project, '20260401_100000__reapply.sql', `
CREATE TABLE IF NOT EXISTS reapply_test (id SERIAL PRIMARY KEY);
ALTER TABLE reapply_test ADD COLUMN IF NOT EXISTS name VARCHAR(100);
`);
    const r = await commandApply(project.config);
    expect(r.applied).toHaveLength(1);

    const records = await queryTestDb(
      "SELECT * FROM schema_migrations WHERE file_name='20260401_100000__reapply.sql'",
    );
    expect(records.rows.length).toBe(2);
  });

  it('detects ancestor revert', async () => {
    const v1 = 'CREATE TABLE IF NOT EXISTS anc (id SERIAL PRIMARY KEY);';
    await writeMigration(project, '20260401_100000__anc.sql', v1);
    await commandApply(project.config);

    await writeMigration(project, '20260401_100000__anc.sql', `
CREATE TABLE IF NOT EXISTS anc (id SERIAL PRIMARY KEY);
ALTER TABLE anc ADD COLUMN IF NOT EXISTS v2 BOOLEAN;
`);
    await commandApply(project.config);

    await writeMigration(project, '20260401_100000__anc.sql', v1);
    const r = await commandApply(project.config);
    expect(r.errors[0]).toContain('Ancestor revert');
  });

  it('detects tampering on non-latest file', async () => {
    const a = 'CREATE TABLE IF NOT EXISTS ta (id SERIAL PRIMARY KEY);';
    const b = 'CREATE TABLE IF NOT EXISTS tb (id SERIAL PRIMARY KEY);';
    await writeMigration(project, '20260401_100000__ta.sql', a);
    await writeMigration(project, '20260401_110000__tb.sql', b);
    await saveMetadata(project.config, {
      migrations: [
        { file: '20260401_100000__ta.sql', checksum: checksumString(a) },
        { file: '20260401_110000__tb.sql', checksum: checksumString(b) },
      ],
    });
    await commandApply(project.config);

    await writeMigration(project, '20260401_100000__ta.sql', 'SELECT 1;');
    const r = await commandApply(project.config);
    expect(r.errors[0]).toContain('Tampering detected');
  });

  it('failed → resolve → apply succeeds', async () => {
    const bad = 'CREATE TABLE bad_syntax (id SERIAL PRIMARY KEY;';
    const good = 'CREATE TABLE IF NOT EXISTS good_table (id SERIAL PRIMARY KEY);';
    await writeMigration(project, '20260401_100000__bad.sql', bad);
    await writeMigration(project, '20260401_110000__good.sql', good);
    await saveMetadata(project.config, {
      migrations: [
        { file: '20260401_100000__bad.sql', checksum: checksumString(bad) },
        { file: '20260401_110000__good.sql', checksum: checksumString(good) },
      ],
    });

    const r1 = await commandApply(project.config);
    expect(r1.failed).toBe('20260401_100000__bad.sql');

    const r2 = await commandApply(project.config);
    expect(r2.errors[0]).toContain('Unresolved failed');

    await commandResolve(project.config, '20260401_100000__bad.sql');

    const r3 = await commandApply(project.config);
    expect(r3.applied).toContain('20260401_110000__good.sql');
    expect(r3.errors).toHaveLength(0);

    const st = await commandStatus(project.config);
    const badE = st.entries.find(e => e.fileName === '20260401_100000__bad.sql');
    expect(badE?.status).toBe('skipped');
  });

  it('dump → diff → drift detection', async () => {
    await writeMigration(project, '20260401_100000__dump.sql',
      'CREATE TABLE IF NOT EXISTS dump_t (id SERIAL PRIMARY KEY, name TEXT);');
    await commandApply(project.config);

    const schemaDir = join(project.tempDir, 'db');
    if (!existsSync(schemaDir)) await mkdir(schemaDir, { recursive: true });

    const dumpResult = await commandDump(project.config);
    expect(dumpResult.length).toBeGreaterThan(0);

    const diffResult1 = await commandDiff(project.config);
    expect(diffResult1.identical).toBe(true);

    await queryTestDb('CREATE TABLE drift_t (id SERIAL)');
    const diffResult2 = await commandDiff(project.config);
    expect(diffResult2.identical).toBe(false);
  });

  it('apply --verify blocks on schema drift', async () => {
    await writeMigration(project, '20260401_100000__vfy.sql',
      'CREATE TABLE IF NOT EXISTS vfy_t (id SERIAL PRIMARY KEY);');
    await commandApply(project.config);

    const schemaDir = join(project.tempDir, 'db');
    if (!existsSync(schemaDir)) await mkdir(schemaDir, { recursive: true });
    await commandDump(project.config);

    await queryTestDb('CREATE TABLE manual_drift (id SERIAL)');

    await writeMigration(project, '20260401_110000__next.sql',
      'CREATE TABLE IF NOT EXISTS next_t (id SERIAL PRIMARY KEY);');

    const r = await commandApply(project.config, { verify: true });
    expect(r.errors[0]).toContain('Schema drift');
    expect(r.applied).toHaveLength(0);
  });

  it('apply --verify updates schema after successful apply', async () => {
    await writeMigration(project, '20260401_100000__vfy2.sql',
      'CREATE TABLE IF NOT EXISTS vfy2_t (id SERIAL PRIMARY KEY);');

    const schemaDir = join(project.tempDir, 'db');
    if (!existsSync(schemaDir)) await mkdir(schemaDir, { recursive: true });

    const r = await commandApply(project.config, { verify: true });
    expect(r.applied).toHaveLength(1);
    expect(r.errors).toHaveLength(0);

    const schemaPath = resolveFromConfig(project.config, project.config.schemaFile);
    expect(existsSync(schemaPath)).toBe(true);
    const schema = await readFile(schemaPath, 'utf-8');
    expect(schema).toContain('vfy2_t');
  });

  it('editable with DB shows failed-retryable files', async () => {
    const good = 'CREATE TABLE IF NOT EXISTS ed_a (id SERIAL PRIMARY KEY);';
    const bad = 'CREATE TABLE ed_bad (id SERIAL PRIMARY KEY;';  // syntax error
    const next = 'CREATE TABLE IF NOT EXISTS ed_c (id SERIAL PRIMARY KEY);';
    await writeMigration(project, '20260401_100000__ed_a.sql', good);
    await writeMigration(project, '20260401_110000__ed_bad.sql', bad);
    await writeMigration(project, '20260401_120000__ed_c.sql', next);
    await saveMetadata(project.config, {
      migrations: [
        { file: '20260401_100000__ed_a.sql', checksum: checksumString(good) },
        { file: '20260401_110000__ed_bad.sql', checksum: checksumString(bad) },
        { file: '20260401_120000__ed_c.sql', checksum: checksumString(next) },
      ],
    });

    // ed_a 適用、ed_bad で失敗
    await commandApply(project.config);

    const result = await commandEditable(project.config);
    expect(result.editableFiles).toContain('20260401_120000__ed_c.sql');
    // failed-retryable は最新ファイルではないが failed なので表示される
    const failedEntry = result.entries.find(e => e.reason === 'failed-retryable');
    expect(failedEntry?.fileName).toBe('20260401_110000__ed_bad.sql');
  });
});
