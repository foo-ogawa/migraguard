/**
 * A placeholder (`:name`) that an external executor fills in before it runs a
 * backfill file, such as `:batch_start` and `:batch_end` (docs/expand-contract.md).
 * `::` casts and `:=` assignments are not placeholders.
 */
const PLACEHOLDER_RE = /(?<![:\w]):[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Reads every placeholder as the literal 0 so that the parser can read the file.
 * Each replacement keeps the length of the placeholder, so the statement offsets
 * the parser reports stay those of the original text.
 */
export function maskPlaceholders(sql: string): string {
  return sql.replace(PLACEHOLDER_RE, (placeholder) => '0'.padEnd(placeholder.length, ' '));
}
