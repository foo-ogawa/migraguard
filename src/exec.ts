import { execFile } from 'node:child_process';
import { constants } from 'node:buffer';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The external tools this project drives — pg_dump, mysqldump, sqlite3, psql —
 * write whole schemas and whole dumps to stdout, and `execFile` kills the child
 * once the captured output passes `maxBuffer`. Its default is 1 MiB, which real
 * schemas exceed, so the limit is raised here to the largest output that can
 * still be handed back as a string at all.
 */
export const CAPTURE_LIMIT_BYTES = constants.MAX_STRING_LENGTH;

export interface CapturedOutput {
  stdout: string;
  stderr: string;
}

/**
 * Runs an external command and captures its output. Every command whose output
 * this project reads goes through here, so the capture limit is stated once.
 */
export function runCapturing(
  command: string,
  args: string[],
  env?: Record<string, string>,
): Promise<CapturedOutput> {
  return execFileAsync(command, args, { env, maxBuffer: CAPTURE_LIMIT_BYTES });
}
