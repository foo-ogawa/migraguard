import type { NamingConfig } from './config.js';

export interface ParsedFileName {
  fullName: string;
  prefix: string;
  timestamp: string;
  description: string;
  sortKey: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTimestampRegex(format: string): string {
  if (isSerialFormat(format)) {
    const width = serialWidth(format);
    return `(\\d{${width}})`;
  }
  let regex = escapeRegExp(format);
  regex = regex.replace(/Y+/g, (m) => `(\\d{${m.length}})`);
  regex = regex.replace(/M+/g, (m) => `(\\d{${m.length}})`);
  regex = regex.replace(/D+/g, (m) => `(\\d{${m.length}})`);
  regex = regex.replace(/H+/g, (m) => `(\\d{${m.length}})`);
  regex = regex.replace(/S+/g, (m) => `(\\d{${m.length}})`);

  const fullMatch = regex.match(/\(\\d\{\d+\}\)/g);
  if (!fullMatch) {
    return `(${regex})`;
  }
  return `(${regex.replace(/\(\\d\{\d+\}\)/g, (m) => m.slice(1, -1))})`;
}

function buildFileNameRegex(naming: NamingConfig): RegExp {
  const { pattern, prefix } = naming;
  const timestampRegex = buildTimestampRegex(naming.timestamp);

  let regexStr = escapeRegExp(pattern);
  regexStr = regexStr.replace(
    escapeRegExp('{timestamp}'),
    timestampRegex,
  );
  regexStr = regexStr.replace(
    escapeRegExp('{description}'),
    '([a-zA-Z0-9_]+)',
  );
  regexStr = regexStr.replace(
    escapeRegExp('{prefix}'),
    prefix ? escapeRegExp(prefix) : '',
  );

  regexStr = regexStr.replace(/\\_\\_/g, '__');
  regexStr = regexStr.replace(/^_+/, '');

  return new RegExp(`^${regexStr}$`);
}

export function parseFileName(fileName: string, naming: NamingConfig): ParsedFileName | undefined {
  const regex = buildFileNameRegex(naming);
  const match = fileName.match(regex);
  if (!match) {
    return undefined;
  }

  const timestamp = match[1];
  const description = match[2];
  if (!timestamp || !description) {
    return undefined;
  }

  return {
    fullName: fileName,
    prefix: naming.prefix,
    timestamp,
    description,
    sortKey: timestamp,
  };
}

export function isSerialFormat(format: string): boolean {
  return /^N+$/.test(format);
}

export function serialWidth(format: string): number {
  return format.length;
}

export function generateTimestamp(format: string, now?: Date): string {
  const d = now ?? new Date();
  const Y = d.getFullYear().toString();
  const Mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const D = d.getDate().toString().padStart(2, '0');
  const H = d.getHours().toString().padStart(2, '0');
  const Mi = d.getMinutes().toString().padStart(2, '0');
  const S = d.getSeconds().toString().padStart(2, '0');

  return format
    .replace('YYYY', Y)
    .replace('MM', Mo)
    .replace('DD', D)
    .replace('HH', H)
    .replace('MM', Mi)
    .replace('SS', S);
}

export function nextSerialNumber(
  format: string,
  existingParsed: ParsedFileName[],
): string {
  const width = serialWidth(format);
  let maxNum = 0;
  for (const p of existingParsed) {
    const num = parseInt(p.timestamp, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }
  return String(maxNum + 1).padStart(width, '0');
}

export function generateFileName(
  description: string,
  naming: NamingConfig,
  options?: { now?: Date; existingParsed?: ParsedFileName[] },
): string {
  let ts: string;
  if (isSerialFormat(naming.timestamp)) {
    ts = nextSerialNumber(naming.timestamp, options?.existingParsed ?? []);
  } else {
    ts = generateTimestamp(naming.timestamp, options?.now);
  }

  let name = naming.pattern
    .replace('{timestamp}', ts)
    .replace('{description}', description)
    .replace('{prefix}', naming.prefix);

  name = name.replace(/^_+/, '');
  name = name.replace(/__+/g, '__');

  return name;
}

export function compareSortKeys(a: string, b: string): number {
  return a.localeCompare(b);
}
