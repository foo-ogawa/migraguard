import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConfig } from '../src/config.js';
import { dumpSchema } from '../src/dumper.js';
import { executePsqlFile } from '../src/psql.js';

/**
 * Real schemas are routinely larger than Node's 1 MiB execFile default, so
 * every dump path has to survive output that big. 2.2 MiB is the size of the
 * schema that first hit the limit.
 */
const OUTPUT_BYTES = 2.2 * 1024 * 1024;
const LINE = 'CREATE TABLE t (id integer);';

let binDir: string;
let originalPath: string | undefined;

/** Writes an executable that floods stdout with `OUTPUT_BYTES` of DDL. */
async function fakeTool(name: string): Promise<string> {
  const lines = Math.ceil(OUTPUT_BYTES / (LINE.length + 1));
  const path = join(binDir, name);
  await writeFile(
    path,
    `#!/bin/sh\nexec node -e 'process.stdout.write("${LINE}\\n".repeat(${lines}))'\n`,
    'utf-8',
  );
  await chmod(path, 0o755);
  return path;
}

beforeEach(async () => {
  binDir = await mkdtemp(join(tmpdir(), 'mg-capture-'));
  originalPath = process.env['PATH'];
  process.env['PATH'] = `${binDir}:${originalPath ?? ''}`;
});

afterEach(async () => {
  process.env['PATH'] = originalPath;
  await rm(binDir, { recursive: true, force: true });
});

describe('dump output larger than the execFile default buffer', () => {
  it('captures a 2.2 MiB pg_dump through the configured dump command', async () => {
    const tool = await fakeTool('pg_dump');
    const config = buildConfig(
      { dialect: 'postgresql', dump: { pgDumpCommand: [tool] } },
      binDir,
    );

    const schema = await dumpSchema(config);
    expect(schema.length).toBeGreaterThan(OUTPUT_BYTES);
  });

  it('captures a 2.2 MiB pg_dump resolved from PATH', async () => {
    await fakeTool('pg_dump');
    const config = buildConfig({ dialect: 'postgresql' }, binDir);

    const schema = await dumpSchema(config);
    expect(schema.length).toBeGreaterThan(OUTPUT_BYTES);
  });

  it('captures a 2.2 MiB mysqldump', async () => {
    await fakeTool('mysqldump');
    const config = buildConfig({ dialect: 'mysql' }, binDir);

    const schema = await dumpSchema(config);
    expect(schema.length).toBeGreaterThan(OUTPUT_BYTES);
  });

  it('captures a 2.2 MiB sqlite3 .schema', async () => {
    await fakeTool('sqlite3');
    const config = buildConfig({ dialect: 'sqlite' }, binDir);

    const schema = await dumpSchema(config);
    expect(schema.length).toBeGreaterThan(OUTPUT_BYTES);
  });

  it('captures 2.2 MiB of psql output', async () => {
    await fakeTool('psql');
    const config = buildConfig({ dialect: 'postgresql' }, binDir);

    const result = await executePsqlFile(config, join(binDir, 'migration.sql'));
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(OUTPUT_BYTES);
  });
});

describe('external command capture', () => {
  it('goes through the shared runner in every hand-written source file', async () => {
    const files = await collectSources('src');
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      if (file === join('src', 'exec.ts')) continue;
      if (file.startsWith(join('src', 'generated'))) continue;
      const source = await readFile(file, 'utf-8');
      if (source.includes('promisify(execFile)')) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});

async function collectSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSources(path)));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}
