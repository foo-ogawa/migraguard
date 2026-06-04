import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalInsightSchema } from 'agent-contracts-analyzer';
import { buildConfig } from '../../src/config.js';
import {
  buildDependencyGraphFromFiles,
  detectCycles,
} from '../../src/deps.js';
import {
  buildAnchorMappings,
  buildExternalInsight,
  buildExternalInsightFromGraph,
  createMigraguardInsightProvider,
  MigraguardInsightProvider,
} from '../../src/external/insight-provider.js';
import { scanMigrations } from '../../src/scanner.js';

describe('external/insight-provider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'migraguard-insight-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeConfig() {
    return buildConfig({
      migrationsDir: 'db/migrations',
      metadataFile: 'db/.migraguard/metadata.json',
    }, tempDir);
  }

  async function setupMigration(fileName: string, content: string) {
    const migDir = join(tempDir, 'db', 'migrations');
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, fileName), content);
  }

  it('implements InsightProvider with correct name', () => {
    const provider = createMigraguardInsightProvider();
    expect(provider).toBeInstanceOf(MigraguardInsightProvider);
    expect(provider.name).toBe('migraguard');
  });

  it('converts schema object dependency edges with weight 0.9', async () => {
    await setupMigration(
      '20260301_100000__create_users.sql',
      'CREATE TABLE users (id INT PRIMARY KEY);',
    );
    await setupMigration(
      '20260302_100000__create_posts.sql',
      'CREATE TABLE posts (id INT, user_id INT REFERENCES users(id));',
    );

    const insight = await buildExternalInsight({ projectRoot: tempDir });

    expect(insight.source).toBe('migraguard');
    expect(insight.edges).toHaveLength(1);
    expect(insight.edges[0]).toMatchObject({
      from: '20260302_100000__create_posts.sql',
      to: '20260301_100000__create_users.sql',
      kind: 'schema_object_dependency',
      propagation: 'backward',
      weight: 0.9,
      metadata: { via: 'users', objectType: 'table' },
    });
  });

  it('converts explicit and config dependencies with weight 1.0', async () => {
    await writeFile(
      join(tempDir, 'migraguard.config.json'),
      JSON.stringify({
        migrationsDir: 'db/migrations',
        metadataFile: 'db/.migraguard/metadata.json',
        dependencies: {
          '20260303_100000__config.sql': ['20260301_100000__base.sql'],
        },
      }),
    );
    await setupMigration('20260301_100000__base.sql', 'CREATE TABLE base (id INT);');
    await setupMigration(
      '20260302_100000__explicit.sql',
      '-- migraguard:depends-on 20260301_100000__base.sql\nCREATE TABLE x (id INT);',
    );
    await setupMigration('20260303_100000__config.sql', 'CREATE TABLE y (id INT);');

    const insight = await buildExternalInsight({ projectRoot: tempDir });
    const explicit = insight.edges.find((e) => e.from.includes('explicit'));
    const config = insight.edges.find((e) => e.from.includes('config'));

    expect(explicit).toMatchObject({
      kind: 'explicit_dependency',
      weight: 1.0,
      metadata: { via: '(explicit)' },
    });
    expect(config).toMatchObject({
      kind: 'config_dependency',
      weight: 1.0,
      metadata: { via: '(config)' },
    });
  });

  it('builds per-file and group anchor mappings for expand/contract', async () => {
    const group = '20260315_100000__rename_status';
    const migDir = join(tempDir, 'db', 'migrations', group);
    await mkdir(migDir, { recursive: true });
    await writeFile(join(migDir, '1_expand.sql'), 'CREATE TABLE t (id INT);');
    await writeFile(join(migDir, '4_contract.sql'), 'DROP TABLE IF EXISTS t;');

    const config = makeConfig();
    const files = await scanMigrations(config);
    const mappings = buildAnchorMappings(files, tempDir);

    const groupMapping = mappings.find((m) => m.domainId === group);
    expect(groupMapping?.filePaths).toEqual([
      `db/migrations/${group}/1_expand.sql`,
      `db/migrations/${group}/4_contract.sql`,
    ]);

    const expandMapping = mappings.find((m) => m.domainId === `${group}/1_expand.sql`);
    expect(expandMapping?.filePaths).toEqual([`db/migrations/${group}/1_expand.sql`]);
  });

  it('excludes cycle edges and records cycle warnings', async () => {
    await setupMigration(
      '20260301_100000__a.sql',
      `-- migraguard:depends-on 20260303_100000__c.sql\nCREATE TABLE a (id INT);`,
    );
    await setupMigration(
      '20260302_100000__b.sql',
      '-- migraguard:depends-on 20260301_100000__a.sql\nCREATE TABLE b (id INT);',
    );
    await setupMigration(
      '20260303_100000__c.sql',
      '-- migraguard:depends-on 20260302_100000__b.sql\nCREATE TABLE c (id INT);',
    );

    const config = makeConfig();
    const files = await scanMigrations(config);
    const graph = await buildDependencyGraphFromFiles(files, config);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);

    const insight = buildExternalInsightFromGraph(graph, files, tempDir, cycles);
    expect(insight.edges).toHaveLength(0);

    const warnings = insight.anchorMapping?.find((m) => m.domainId === '_migraguard:warnings');
    expect(warnings).toBeDefined();
    const parsed = JSON.parse(warnings!.artifactId!) as { cycleWarnings: string[][] };
    expect(parsed.cycleWarnings.length).toBeGreaterThan(0);
  });

  it('produces ExternalInsight JSON that passes analyzer schema validation', async () => {
    await setupMigration(
      '20260301_100000__create_users.sql',
      'CREATE TABLE users (id INT PRIMARY KEY);',
    );
    const insight = await buildExternalInsight({ projectRoot: tempDir });
    const validated = ExternalInsightSchema.safeParse(insight);
    expect(validated.success).toBe(true);
  });

  it('provide() resolves insight from query.projectRoot', async () => {
    await setupMigration('20260301_100000__solo.sql', 'CREATE TABLE solo (id INT);');
    const provider = createMigraguardInsightProvider();
    const insight = await provider.provide({ projectRoot: tempDir });
    expect(insight.anchorMapping?.some((m) => m.domainId === '20260301_100000__solo.sql')).toBe(true);
  });
});
