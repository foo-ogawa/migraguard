import libpg from 'libpg-query';

/**
 * AST nodes as plain records. The dependency analyzer and the lint rules both
 * walk the parse tree by key, so they share one view of it and one parse
 * boundary.
 */
export type RawStatement = Record<string, Record<string, unknown>>;

export interface RawStatementEntry {
  stmt: RawStatement;
  /** Offset of the statement in the parsed SQL. */
  location: number;
  /** Length of the statement, absent for the last one in the string. */
  length?: number;
}

/** Returns null when the SQL does not parse, which callers report as no result. */
export async function parseStatements(sql: string): Promise<RawStatementEntry[] | null> {
  try {
    const ast = await libpg.parse(sql);
    return (ast.stmts ?? []).map((entry) => ({
      stmt: (entry.stmt ?? {}) as RawStatement,
      location: entry.stmt_location ?? 0,
      length: entry.stmt_len,
    }));
  } catch {
    return null;
  }
}

/**
 * Reads the source text of one statement back out of the parsed SQL. The
 * parser counts offsets in bytes, while a JavaScript string is indexed in
 * UTF-16 code units, so the two drift apart after any multi-byte character
 * and the text has to be cut out of the encoded form.
 */
export function statementText(sql: string, entry: RawStatementEntry): string {
  const bytes = Buffer.from(sql, 'utf8');
  const end = entry.length === undefined
    ? bytes.length
    : entry.location + entry.length;
  return bytes.subarray(entry.location, end).toString('utf8');
}

export type PlPgSqlParse =
  | { ok: true; tree: unknown }
  | { ok: false; reason: string };

/**
 * Parses a PL/pgSQL carrying statement (`DO`, `CREATE FUNCTION`) into its
 * PL/pgSQL tree. A rejected body is reported with the reason the parser gave:
 * it means the migration is broken or the analyzer cut the statement out
 * wrongly, and neither may pass as "this file has no dependencies".
 */
export async function parsePlPgSql(statement: string): Promise<PlPgSqlParse> {
  try {
    return { ok: true, tree: await libpg.parsePlPgSQL(statement) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
