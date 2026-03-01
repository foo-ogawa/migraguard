import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function checksumString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export async function checksumFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return checksumString(content);
}
