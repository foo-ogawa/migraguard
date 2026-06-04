import { buildExternalInsight } from '../external/insight-provider.js';
import type { ExternalInsight } from '../external/analyzer-types.js';
import { resolve } from 'node:path';

export interface InsightsOptions {
  format?: string;
  projectRoot?: string;
}

export async function commandInsights(
  options: InsightsOptions = {},
): Promise<ExternalInsight> {
  const format = options.format ?? 'json';
  if (format !== 'json') {
    throw new Error(`Unsupported format: ${format}. Only "json" is supported.`);
  }

  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const insight = await buildExternalInsight({ projectRoot });
  process.stdout.write(`${JSON.stringify(insight)}\n`);
  return insight;
}
