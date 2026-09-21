import type { LintRule, RuleContext } from './engine.js';

/**
 * `varchar_col IN ('a', 'b')` does not survive a dump → restore → dump cycle.
 *
 * `character varying` is not `text`, so PostgreSQL casts the left operand and
 * pg_dump renders the cast around the whole array:
 *
 *     CHECK (((s)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[])))
 *
 * Replaying that output and dumping again distributes the cast to the elements:
 *
 *     CHECK (((s)::text = ANY (ARRAY[('a'::character varying)::text, ('b'::character varying)::text])))
 *
 * The two are semantically identical but textually different, so a database
 * built from a dump never matches a database built from the original DDL. That
 * breaks `diff` for anyone who seeds an environment — a CI shadow database, for
 * example — from `schema.sql` and compares it against a live database.
 *
 * Casting explicitly is a fixed point in both directions:
 *
 *     CHECK (s::text = ANY (ARRAY['a', 'b']::text[]))
 *
 * Only `character varying` is affected. `text`, `bpchar`, numeric, date,
 * timestamp, uuid, boolean and enum operands all round-trip unchanged, so the
 * rule fires only where the column is declared `varchar` in the same statement.
 * Predicates whose operand type is not visible from a single file — ALTER TABLE
 * ADD CONSTRAINT, view definitions, partial index predicates — are not reported,
 * because the suggested rewrite would be wrong for a date or uuid column.
 */

type Node = Record<string, unknown>;

const VARCHAR_TYPE_NAMES = new Set(['varchar', 'character varying']);

function asNode(value: unknown): Node | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : undefined;
}

function lastName(names: unknown): string | undefined {
  if (!Array.isArray(names) || names.length === 0) return undefined;
  const str = asNode(asNode(names[names.length - 1])?.String);
  return typeof str?.sval === 'string' ? str.sval : undefined;
}

function isTextCast(value: unknown): boolean {
  const cast = asNode(asNode(value)?.TypeCast);
  if (!cast) return false;
  return lastName(asNode(cast.typeName)?.names) === 'text';
}

function columnNameOf(value: unknown): string | undefined {
  const node = asNode(value);
  if (!node) return undefined;
  const ref = asNode(node.ColumnRef) ?? asNode(asNode(asNode(node.TypeCast)?.arg)?.ColumnRef);
  if (!ref || !Array.isArray(ref.fields)) return undefined;
  return lastName(ref.fields);
}

/** Column name → declared type name, for statements that carry column definitions. */
function varcharColumns(node: Node): Set<string> {
  const columns = new Set<string>();
  const elts = node.tableElts;
  if (!Array.isArray(elts)) return columns;
  for (const elt of elts) {
    const col = asNode(asNode(elt)?.ColumnDef);
    if (typeof col?.colname !== 'string') continue;
    const type = lastName(asNode(col.typeName)?.names);
    if (type && VARCHAR_TYPE_NAMES.has(type)) columns.add(col.colname);
  }
  return columns;
}

function collectUnstable(value: unknown, varcharCols: Set<string>, found: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectUnstable(item, varcharCols, found);
    return;
  }
  const node = asNode(value);
  if (!node) return;

  const expr = asNode(node.A_Expr);
  if (expr && (expr.kind === 'AEXPR_IN' || expr.kind === 'AEXPR_OP_ANY')) {
    const column = columnNameOf(expr.lexpr);
    if (column && varcharCols.has(column) && !isTextCast(expr.lexpr)) {
      found.push(column);
    }
  }

  for (const key of Object.keys(node)) collectUnstable(node[key], varcharCols, found);
}

function reportCheckConstraints(
  node: Node,
  varcharCols: Set<string>,
  ctx: RuleContext,
  where: string,
): void {
  if (varcharCols.size === 0) return;

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const current = asNode(value);
    if (!current) return;
    for (const key of Object.keys(current)) {
      const child = current[key];
      const constraint = asNode(child);
      if (key === 'Constraint' && constraint?.contype === 'CONSTR_CHECK') {
        const found: string[] = [];
        collectUnstable(constraint.raw_expr, varcharCols, found);
        const name = typeof constraint.conname === 'string' ? `"${constraint.conname}" ` : '';
        for (const column of found) {
          ctx.report({
            message: `CHECK constraint ${name}in ${where} compares varchar column "${column}" against a value list without an explicit ::text cast`,
            hint: `Write it as ${column}::text = ANY (ARRAY['a', 'b']::text[]) — on a varchar column, IN (...) changes shape after dump → restore → dump and breaks schema diffs`,
          });
        }
      }
      walk(child);
    }
  };
  walk(node);
}

export const banUnstableListPredicate: LintRule = {
  id: 'ban-unstable-list-predicate',
  description: 'IN (...) on a varchar column changes shape after dump → restore → dump and breaks schema diffs',
  create() {
    return {
      CreateStmt(node, ctx) {
        reportCheckConstraints(node, varcharColumns(node), ctx, 'CREATE TABLE');
      },

      CreateDomainStmt(node, ctx) {
        // VALUE takes the domain's base type.
        const baseType = lastName(asNode(node.typeName)?.names);
        if (!baseType || !VARCHAR_TYPE_NAMES.has(baseType)) return;
        reportCheckConstraints(node, new Set(['value']), ctx, 'CREATE DOMAIN');
      },
    };
  },
};
