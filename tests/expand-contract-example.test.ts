import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConfig } from '../src/config.js';
import { scanMigrations } from '../src/scanner.js';
import { checksumFile } from '../src/checksum.js';
import { commandCheck } from '../src/commands/check.js';
import { commandLint } from '../src/commands/lint.js';
import { commandNew } from '../src/commands/new.js';
import { buildDependencyGraph, parseExplicitDepsFromSql } from '../src/deps.js';
import { saveMetadata } from '../src/metadata.js';
import type { MetadataJson } from '../src/metadata.js';
import {
  deriveGroupState,
  deriveAllGroupStates,
  isGroupOpen,
  canAdvanceToPhase,
} from '../src/group-state.js';
import type { MigrationRecord } from '../src/db.js';

const EXAMPLES_DIR = join(__dirname, '..', 'examples', 'social-app');
const GROUP_NAME = '20260401_100000__rename_username_to_handle';

describe('Expand/Contract example — social-app', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-ec-test-'));
    await cp(join(EXAMPLES_DIR, 'db'), join(tempDir, 'db'), { recursive: true });
    await rebuildMetadataChecksums();
  });

  async function rebuildMetadataChecksums() {
    const cfg = config();
    const files = await scanMigrations(cfg);
    const metaPath = join(tempDir, 'db/.migraguard/metadata.json');
    const raw = JSON.parse(await readFile(metaPath, 'utf-8')) as MetadataJson;
    for (const entry of raw.migrations) {
      const file = files.find((f) => f.fileName === entry.file);
      if (file) {
        entry.checksum = await checksumFile(file.filePath);
      }
    }
    await writeFile(metaPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
  }

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function config() {
    return buildConfig({ migrationsDir: 'db/migrations' }, tempDir);
  }

  // -----------------------------------------------------------------------
  // Scanner
  // -----------------------------------------------------------------------
  describe('scanner', () => {
    it('discovers Class A and Class B files sorted by timestamp', async () => {
      const files = await scanMigrations(config());

      const classAFiles = files.filter((f) => f.migrationClass === 'safe');
      const classBFiles = files.filter((f) => f.migrationClass === 'expand_contract');

      expect(classAFiles.length).toBe(8);
      expect(classBFiles.length).toBe(4);

      expect(classBFiles[0].phase).toBe('expand');
      expect(classBFiles[1].phase).toBe('backfill');
      expect(classBFiles[2].phase).toBe('switch');
      expect(classBFiles[3].phase).toBe('contract');

      for (const f of classBFiles) {
        expect(f.groupName).toBe(GROUP_NAME);
        expect(f.fileName).toMatch(new RegExp(`^${GROUP_NAME}/\\d_\\w+\\.sql$`));
      }
    });

    it('Class B files have correct filePath pointing to actual phase files', async () => {
      const files = await scanMigrations(config());
      const expandFile = files.find((f) => f.phase === 'expand');

      expect(expandFile).toBeDefined();
      const content = await readFile(expandFile!.filePath, 'utf-8');
      expect(content).toContain('ADD COLUMN IF NOT EXISTS handle');
    });

    it('Class B files sort after earlier Class A files', async () => {
      const files = await scanMigrations(config());
      const fileNames = files.map((f) => f.fileName);

      const lastClassA = '20260322_110000__create_read_receipts.sql';
      const firstClassB = `${GROUP_NAME}/1_expand.sql`;

      const lastClassAIdx = fileNames.indexOf(lastClassA);
      const firstClassBIdx = fileNames.indexOf(firstClassB);

      expect(lastClassAIdx).toBeLessThan(firstClassBIdx);
    });

    it('all phase files share the same phaseFiles array', async () => {
      const files = await scanMigrations(config());
      const classBFiles = files.filter((f) => f.migrationClass === 'expand_contract');

      const expandPhaseFiles = classBFiles[0].phaseFiles;
      expect(expandPhaseFiles).toHaveLength(4);
      for (const f of classBFiles) {
        expect(f.phaseFiles).toBe(expandPhaseFiles);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Checksum
  // -----------------------------------------------------------------------
  describe('checksum', () => {
    it('computes unique checksums per phase file', async () => {
      const files = await scanMigrations(config());
      const classBFiles = files.filter((f) => f.migrationClass === 'expand_contract');

      const checksums = new Set<string>();
      for (const f of classBFiles) {
        const cs = await checksumFile(f.filePath);
        checksums.add(cs);
      }
      expect(checksums.size).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Check command
  // -----------------------------------------------------------------------
  describe('check', () => {
    it('passes when Class B files are new (not in metadata)', async () => {
      const result = await commandCheck(config());
      expect(result.ok).toBe(true);
    });

    it('passes when Class B files are registered in metadata', async () => {
      const files = await scanMigrations(config());
      const classBFiles = files.filter((f) => f.migrationClass === 'expand_contract');

      const cfg = config();
      const metadata: MetadataJson = JSON.parse(
        await readFile(join(tempDir, 'db/.migraguard/metadata.json'), 'utf-8'),
      );

      for (const f of classBFiles) {
        const cs = await checksumFile(f.filePath);
        metadata.migrations.push({ file: f.fileName, checksum: cs });
      }
      await saveMetadata(cfg, metadata);

      const result = await commandCheck(cfg);
      expect(result.ok).toBe(true);
    });

    it('fails when expand phase is missing from group', async () => {
      const expandPath = join(tempDir, 'db/migrations', GROUP_NAME, '1_expand.sql');
      await rm(expandPath);

      const result = await commandCheck(config());
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes('missing required expand'))).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Lint
  // -----------------------------------------------------------------------
  describe('lint', () => {
    it('expand phase passes general lint rules (IF NOT EXISTS, lock_timeout)', async () => {
      const files = await scanMigrations(config());
      const expandFile = files.find((f) => f.phase === 'expand')!;
      const sql = await readFile(expandFile.filePath, 'utf-8');

      expect(sql).toContain('IF NOT EXISTS');
      expect(sql).toContain('SET lock_timeout');
      expect(sql).toContain('RESET lock_timeout');
    });

    it('backfill phase has WHERE clause (backfill-requires-where-clause compliance)', async () => {
      const files = await scanMigrations(config());
      const backfillFile = files.find((f) => f.phase === 'backfill')!;
      const sql = await readFile(backfillFile.filePath, 'utf-8');

      expect(sql).toContain('WHERE handle IS NULL');
    });

    it('contract phase has allow directive for ban-drop-column', async () => {
      const files = await scanMigrations(config());
      const contractFile = files.find((f) => f.phase === 'contract')!;
      const sql = await readFile(contractFile.filePath, 'utf-8');

      expect(sql).toContain('migraguard:allow ban-drop-column');
      expect(sql).toContain('DROP COLUMN IF EXISTS username');
    });

    it('phase-specific rules only apply to matching phases', async () => {
      const cfg = buildConfig({
        migrationsDir: 'db/migrations',
        lint: {
          rules: {
            'require-concurrent-index': 'off',
            'ban-concurrent-index-in-transaction': 'off',
            'require-analyze-after-index': 'off',
            'require-if-not-exists': 'off',
            'ban-drop-column': 'off',
            'require-drop-index-concurrently': 'off',
            'require-lock-timeout': 'off',
            'require-statement-timeout': 'off',
            'require-reset-timeouts': 'off',
            'ban-rename-column': 'off',
            'contract-requires-allow-directive': 'off',
          },
        },
      }, tempDir);

      const result = await commandLint(cfg);
      expect(result.filesLinted).toBe(12);
      expect(result.ok).toBe(true);
    });

    it('contract-requires-allow-directive fires only on contract phase', async () => {
      const cfg = buildConfig({
        migrationsDir: 'db/migrations',
        lint: {
          rules: {
            'require-concurrent-index': 'off',
            'ban-concurrent-index-in-transaction': 'off',
            'require-analyze-after-index': 'off',
            'require-if-not-exists': 'off',
            'require-lock-timeout': 'off',
            'require-statement-timeout': 'off',
            'require-reset-timeouts': 'off',
            'ban-drop-column': 'off',
            'ban-rename-column': 'off',
            'ban-drop-cascade': 'off',
            'require-drop-index-concurrently': 'off',
          },
        },
      }, tempDir);

      const result = await commandLint(cfg);
      expect(result.errors).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Dependency parsing
  // -----------------------------------------------------------------------
  describe('dependency parsing', () => {
    it('parses phase-level depends-on from SQL', () => {
      const sql = `-- migraguard:depends-on 20260401_100000__rename_username_to_handle:expand
SELECT 1;`;
      const deps = parseExplicitDepsFromSql(sql);
      expect(deps).toHaveLength(1);
      expect(deps[0].target).toBe('20260401_100000__rename_username_to_handle');
      expect(deps[0].phase).toBe('expand');
    });

    it('builds dependency graph including Class B expand files', async () => {
      const cfg = config();
      const graph = await buildDependencyGraph(cfg);
      const expandFileName = `${GROUP_NAME}/1_expand.sql`;

      expect(graph.files).toContain(expandFileName);
    });

    it('Class A file can depend on a Class B group via phase suffix', async () => {
      const depSql = `-- migraguard:depends-on ${GROUP_NAME}:expand
SET lock_timeout = '5s';
SET statement_timeout = '30s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_handle_lower
  ON users (lower(handle));
ANALYZE users;
RESET lock_timeout;
RESET statement_timeout;
`;
      await writeFile(
        join(tempDir, 'db/migrations', '20260408_100000__add_handle_lower_index.sql'),
        depSql,
      );

      const cfg = config();
      const graph = await buildDependencyGraph(cfg);

      const newFile = '20260408_100000__add_handle_lower_index.sql';
      const expandFile = `${GROUP_NAME}/1_expand.sql`;

      const edge = graph.edges.find(
        (e) => e.from === newFile && e.to === expandFile,
      );
      expect(edge).toBeDefined();
      expect(edge!.via).toBe('(explicit:expand)');
    });
  });

  // -----------------------------------------------------------------------
  // Group state derivation (unit-level, no DB)
  // -----------------------------------------------------------------------
  describe('group state derivation', () => {
    function makeRecord(
      overrides: Partial<MigrationRecord> & { fileName: string },
    ): MigrationRecord {
      return {
        checksum: 'abc',
        status: 'applied',
        appliedAt: new Date('2026-04-01T10:00:00Z'),
        resolvedAt: null,
        migrationClass: 'expand_contract',
        phase: null,
        groupName: null,
        tag: null,
        ...overrides,
      };
    }

    it('derives not_applied for empty records', () => {
      const state = deriveGroupState([], GROUP_NAME);
      expect(state.state).toBe('not_applied');
      expect(isGroupOpen(state)).toBe(false);
    });

    it('derives expand_applied after expand', () => {
      const records = [
        makeRecord({
          fileName: `${GROUP_NAME}/1_expand.sql`,
          phase: 'expand',
          groupName: GROUP_NAME,
        }),
      ];
      const state = deriveGroupState(records, GROUP_NAME);
      expect(state.state).toBe('expand_applied');
      expect(isGroupOpen(state)).toBe(true);
      expect(canAdvanceToPhase(state, 'backfill')).toBe(true);
      expect(canAdvanceToPhase(state, 'contract')).toBe(true);
    });

    it('derives backfill_running during backfill', () => {
      const records = [
        makeRecord({
          fileName: `${GROUP_NAME}/1_expand.sql`,
          phase: 'expand',
          groupName: GROUP_NAME,
        }),
        makeRecord({
          fileName: `${GROUP_NAME}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP_NAME,
          status: 'running',
          appliedAt: new Date('2026-04-02T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP_NAME);
      expect(state.state).toBe('backfill_running');
      expect(isGroupOpen(state)).toBe(true);
      expect(canAdvanceToPhase(state, 'switch')).toBe(false);
    });

    it('derives contract_completed at terminal state', () => {
      const records = [
        makeRecord({
          fileName: `${GROUP_NAME}/1_expand.sql`,
          phase: 'expand',
          groupName: GROUP_NAME,
        }),
        makeRecord({
          fileName: `${GROUP_NAME}/2_backfill.sql`,
          phase: 'backfill',
          groupName: GROUP_NAME,
          appliedAt: new Date('2026-04-02T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP_NAME}/3_switch.sql`,
          phase: 'switch',
          groupName: GROUP_NAME,
          appliedAt: new Date('2026-04-03T08:00:00Z'),
        }),
        makeRecord({
          fileName: `${GROUP_NAME}/4_contract.sql`,
          phase: 'contract',
          groupName: GROUP_NAME,
          appliedAt: new Date('2026-04-04T08:00:00Z'),
        }),
      ];
      const state = deriveGroupState(records, GROUP_NAME);
      expect(state.state).toBe('contract_completed');
      expect(isGroupOpen(state)).toBe(false);
    });

    it('deriveAllGroupStates returns one group for rename_username_to_handle', () => {
      const records = [
        makeRecord({
          fileName: `${GROUP_NAME}/1_expand.sql`,
          phase: 'expand',
          groupName: GROUP_NAME,
        }),
      ];
      const states = deriveAllGroupStates(records);
      expect(states).toHaveLength(1);
      expect(states[0].groupName).toBe(GROUP_NAME);
    });
  });

  // -----------------------------------------------------------------------
  // new --expand-contract
  // -----------------------------------------------------------------------
  describe('new --expand-contract', () => {
    it('creates a migration group directory under the same migrations dir', async () => {
      const cfg = config();
      await commandNew(cfg, 'split_posts_table', { expandContract: true });

      const files = await scanMigrations(cfg);
      const newGroup = files.filter(
        (f) => f.migrationClass === 'expand_contract' && f.parsed.description === 'split_posts_table',
      );
      expect(newGroup).toHaveLength(4);
      expect(newGroup.map((f) => f.phase)).toEqual(['expand', 'backfill', 'switch', 'contract']);
    });

    it('generated expand template contains lock_timeout and IF NOT EXISTS hint', async () => {
      const cfg = config();
      await commandNew(cfg, 'add_email_v2', { expandContract: true });

      const files = await scanMigrations(cfg);
      const expandFile = files.find(
        (f) => f.phase === 'expand' && f.parsed.description === 'add_email_v2',
      )!;
      const content = await readFile(expandFile.filePath, 'utf-8');
      expect(content).toContain('SET lock_timeout');
      expect(content).toContain('IF NOT EXISTS');
    });

    it('generated backfill template contains statement_timeout', async () => {
      const cfg = config();
      await commandNew(cfg, 'normalize_emails', { expandContract: true });

      const files = await scanMigrations(cfg);
      const backfillFile = files.find(
        (f) => f.phase === 'backfill' && f.parsed.description === 'normalize_emails',
      )!;
      const content = await readFile(backfillFile.filePath, 'utf-8');
      expect(content).toContain('SET statement_timeout');
      expect(content).toContain('batch_start');
    });
  });
});
