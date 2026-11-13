/** Output format of the commands that accept `--format text|json`. */
export type OutputFormat = 'text' | 'json';

export function parseOutputFormat(value: string | undefined): OutputFormat {
  if (value === undefined || value === 'text' || value === 'json') return value ?? 'text';
  throw new Error(`Unsupported format: ${value}. Use "text" or "json".`);
}

/** In json format stdout carries this document only; human-readable lines go to stderr or are omitted. */
export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
