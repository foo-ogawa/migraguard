import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import { resolveFromConfig } from '../config.js';
import { dumpSchema } from '../dumper.js';

export async function commandDump(config: MigraguardConfig): Promise<string> {
  const schema = await dumpSchema(config);
  const schemaPath = resolveFromConfig(config, config.schemaFile);

  const dir = dirname(schemaPath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(schemaPath, schema, 'utf-8');
  console.log(chalk.green(`✓ Schema dumped to: ${config.schemaFile}`));

  return schema;
}
