import { styleText } from 'node:util';

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

type Format = Parameters<typeof styleText>[0];

const paint = (format: Format) => (text: string): string => styleText(format, text);

/**
 * Colors of the human-readable output. The text stays plain unless stdout is a
 * terminal that shows colors, following NO_COLOR, FORCE_COLOR and NODE_DISABLE_COLORS.
 */
export const style = {
  red: paint('red'),
  green: paint('green'),
  yellow: paint('yellow'),
  blue: paint('blue'),
  magenta: paint('magenta'),
  cyan: paint('cyan'),
  gray: paint('gray'),
  bold: paint('bold'),
  boldRed: paint(['red', 'bold']),
};
