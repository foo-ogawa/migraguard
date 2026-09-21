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

/** Reads the source text of one statement back out of the parsed SQL. */
export function statementText(sql: string, entry: RawStatementEntry): string {
  return entry.length === undefined
    ? sql.slice(entry.location)
    : sql.slice(entry.location, entry.location + entry.length);
}

/**
 * Parses a PL/pgSQL carrying statement (`DO`, `CREATE FUNCTION`) into its
 * PL/pgSQL tree. Returns null when the body does not parse.
 */
export async function parsePlPgSql(statement: string): Promise<unknown | null> {
  try {
    return await libpg.parsePlPgSQL(statement);
  } catch {
    return null;
  }
}
