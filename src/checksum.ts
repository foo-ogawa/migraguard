import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * Strip SQL comments and normalize whitespace so that comment-only
 * or whitespace-only edits do not change the checksum.
 *
 * Handles:
 *  - Line comments (-- ...)
 *  - Block comments (with PostgreSQL-style nesting)
 *  - Single-quoted strings ('...', with '' escape)
 *  - Double-quoted identifiers ("...", with "" escape)
 *  - Dollar-quoted strings ($$...$$, $tag$...$tag$)
 *  - E'...' escape strings (backslash escapes)
 */
export function normalizeSQL(content: string): string {
  const out: string[] = [];
  let i = 0;
  const len = content.length;
  let lastWasSpace = true;

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    if (ch === '-' && next === '-') {
      i += 2;
      while (i < len && content[i] !== '\n') i++;
      if (i < len) i++;
      if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      continue;
    }

    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < len && depth > 0) {
        if (content[i] === '/' && i + 1 < len && content[i + 1] === '*') {
          depth++; i += 2;
        } else if (content[i] === '*' && i + 1 < len && content[i + 1] === '/') {
          depth--; i += 2;
        } else {
          i++;
        }
      }
      if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      continue;
    }

    if ((ch === 'E' || ch === 'e') && next === "'") {
      out.push(ch, "'");
      i += 2;
      while (i < len) {
        if (content[i] === '\\' && i + 1 < len) {
          out.push(content[i], content[i + 1]);
          i += 2;
        } else if (content[i] === "'") {
          out.push("'");
          i++;
          break;
        } else {
          out.push(content[i]);
          i++;
        }
      }
      lastWasSpace = false;
      continue;
    }

    if (ch === "'") {
      out.push("'");
      i++;
      while (i < len) {
        if (content[i] === "'" && i + 1 < len && content[i + 1] === "'") {
          out.push("''"); i += 2;
        } else if (content[i] === "'") {
          out.push("'"); i++;
          break;
        } else {
          out.push(content[i]); i++;
        }
      }
      lastWasSpace = false;
      continue;
    }

    if (ch === '"') {
      out.push('"');
      i++;
      while (i < len) {
        if (content[i] === '"' && i + 1 < len && content[i + 1] === '"') {
          out.push('""'); i += 2;
        } else if (content[i] === '"') {
          out.push('"'); i++;
          break;
        } else {
          out.push(content[i]); i++;
        }
      }
      lastWasSpace = false;
      continue;
    }

    if (ch === '$') {
      const rest = content.slice(i);
      const m = rest.match(/^\$([A-Za-z_\d]*)\$/);
      if (m) {
        const tag = m[0];
        out.push(tag);
        i += tag.length;
        const closeIdx = content.indexOf(tag, i);
        if (closeIdx >= 0) {
          out.push(content.slice(i, closeIdx + tag.length));
          i = closeIdx + tag.length;
        } else {
          out.push(content.slice(i));
          i = len;
        }
        lastWasSpace = false;
        continue;
      }
    }

    if (/\s/.test(ch)) {
      if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      i++;
      continue;
    }

    out.push(ch);
    lastWasSpace = false;
    i++;
  }

  return out.join('').trim();
}

export function checksumString(content: string): string {
  return createHash('sha256').update(normalizeSQL(content), 'utf-8').digest('hex');
}

export async function checksumFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return checksumString(content);
}
