import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Dialect } from './config.js';

/**
 * Strip SQL comments and normalize whitespace so that comment-only
 * or whitespace-only edits do not change the checksum. Text the database
 * executes is never treated as a comment, so the lexical rules follow the
 * dialect the file is run with.
 *
 * Handles:
 *  - Line comments (-- ...; MySQL requires whitespace after --)
 *  - Block comments (nested in PostgreSQL; MySQL and SQLite end them at the first *\/)
 *  - MySQL executable comments (/*! ... *\/, /*M! ... *\/), which are kept
 *  - MySQL # comments, read as one token and kept as written
 *  - Single-quoted strings ('...', with '' escape; MySQL also \ escapes)
 *  - Double-quoted identifiers ("...", with "" escape; MySQL strings also \ escapes)
 *  - Backquoted identifiers (MySQL, SQLite) and [bracketed] identifiers (SQLite)
 *  - Dollar-quoted strings ($$...$$, $tag$...$tag$)
 *  - E'...' escape strings (backslash escapes)
 */
export function normalizeSQL(content: string, dialect: Dialect): string {
  const mysql = dialect === 'mysql';
  const nestedComments = dialect === 'postgresql';
  const out: string[] = [];
  let i = 0;
  const len = content.length;
  let lastWasSpace = true;

  // Emits text with runs of whitespace collapsed, as plain SQL is.
  const pushCollapsed = (text: string): void => {
    for (const c of text) {
      if (/\s/.test(c)) {
        if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      } else {
        out.push(c);
        lastWasSpace = false;
      }
    }
  };

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    if (ch === '-' && next === '-' && (!mysql || i + 2 >= len || /\s/.test(content[i + 2]))) {
      i += 2;
      while (i < len && content[i] !== '\n') i++;
      if (i < len) i++;
      if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      continue;
    }

    if (mysql && ch === '#') {
      const end = content.indexOf('\n', i);
      const stop = end < 0 ? len : end;
      pushCollapsed(content.slice(i, stop));
      i = stop;
      continue;
    }

    if (ch === '/' && next === '*') {
      if (nestedComments) {
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
      } else {
        const end = content.indexOf('*/', i + 2);
        const stop = end < 0 ? len : end + 2;
        const executable = mysql && (content.startsWith('/*!', i) || content.startsWith('/*M!', i));
        if (executable) {
          pushCollapsed(content.slice(i, stop));
          i = stop;
          continue;
        }
        i = stop;
      }
      if (!lastWasSpace) { out.push(' '); lastWasSpace = true; }
      continue;
    }

    if ((ch === '`' && dialect !== 'postgresql') || (ch === '[' && dialect === 'sqlite')) {
      const close = ch === '`' ? '`' : ']';
      let j = i + 1;
      while (j < len) {
        if (content[j] === close && close === '`' && content[j + 1] === '`') { j += 2; continue; }
        if (content[j] === close) { j++; break; }
        j++;
      }
      pushCollapsed(content.slice(i, j));
      i = j;
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

    if (ch === "'" || ch === '"') {
      out.push(ch);
      i++;
      while (i < len) {
        if (mysql && content[i] === '\\' && i + 1 < len) {
          out.push(content[i], content[i + 1]); i += 2;
        } else if (content[i] === ch && i + 1 < len && content[i + 1] === ch) {
          out.push(ch, ch); i += 2;
        } else if (content[i] === ch) {
          out.push(ch); i++;
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

export function checksumString(content: string, dialect: Dialect): string {
  return createHash('sha256').update(normalizeSQL(content, dialect), 'utf-8').digest('hex');
}

export async function checksumFile(filePath: string, dialect: Dialect): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return checksumString(content, dialect);
}
