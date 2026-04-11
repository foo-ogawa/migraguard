import nodeSqlParser from 'node-sql-parser';
const { Parser } = nodeSqlParser;
import type { Phase } from '../naming.js';

export interface GenericRuleReport {
  message: string;
  hint: string;
}

export interface GenericRuleContext {
  report(violation: GenericRuleReport): void;
  createdTables: ReadonlySet<string>;
  inTransaction: boolean;
  rawSql: string;
}

export interface RawViolation {
  rule: string;
  message: string;
  hint: string;
}

export type GenericStmtKey =
  | 'create_table'
  | 'create_index'
  | 'create_view'
  | 'alter'
  | 'drop'
  | 'update'
  | 'delete'
  | 'truncate'
  | 'transaction'
  | '_End';

type GenericNodeHandler = (node: Record<string, unknown>, ctx: GenericRuleContext) => void;

export type GenericNodeVisitors = Partial<Record<GenericStmtKey, GenericNodeHandler>>;

export interface GenericLintRule {
  id: string;
  description: string;
  applicablePhases?: Phase[];
  create(): GenericNodeVisitors;
}

export type GenericDialect = 'mysql' | 'sqlite';

const ALLOW_DIRECTIVE_RE = /^--\s*migraguard:allow\s+(.+)$/gm;

export function parseAllowDirectives(sql: string): Set<string> {
  const allowed = new Set<string>();
  let match;
  while ((match = ALLOW_DIRECTIVE_RE.exec(sql)) !== null) {
    for (const id of match[1].split(/[,\s]+/).filter(Boolean)) {
      allowed.add(id);
    }
  }
  ALLOW_DIRECTIVE_RE.lastIndex = 0;
  return allowed;
}

function toParserDatabase(dialect: GenericDialect): string {
  return dialect === 'mysql' ? 'MySQL' : 'SQLite';
}

function stmtKey(stmt: Record<string, unknown>): GenericStmtKey | null {
  const type = stmt.type as string;
  if (type === 'create') {
    const kw = stmt.keyword as string;
    if (kw === 'table') return 'create_table';
    if (kw === 'index') return 'create_index';
    if (kw === 'view') return 'create_view';
    return null;
  }
  if (type === 'alter') return 'alter';
  if (type === 'drop') return 'drop';
  if (type === 'update') return 'update';
  if (type === 'delete') return 'delete';
  if (type === 'truncate') return 'truncate';
  if (type === 'transaction') return 'transaction';
  return null;
}

export async function runGenericRules(
  sql: string,
  rules: GenericLintRule[],
  dialect: GenericDialect,
): Promise<RawViolation[]> {
  const violations: RawViolation[] = [];

  const allowed = parseAllowDirectives(sql);
  const activeRules = rules.filter((r) => !allowed.has(r.id));
  if (activeRules.length === 0) return violations;

  const visitors: Array<{ ruleId: string; handlers: GenericNodeVisitors }> = [];
  for (const rule of activeRules) {
    visitors.push({ ruleId: rule.id, handlers: rule.create() });
  }

  const createdTables = new Set<string>();
  let inTransaction = false;

  const parser = new Parser();
  let stmts: Array<Record<string, unknown>> = [];
  try {
    const ast = parser.astify(sql, { database: toParserDatabase(dialect) });
    stmts = (Array.isArray(ast) ? ast : [ast]) as unknown as Array<Record<string, unknown>>;
  } catch {
    // parse failure — skip AST walk but still run _End handlers below
  }

  for (const stmt of stmts) {
    const type = stmt.type as string;
    const keyword = stmt.keyword as string | undefined;

    if (type === 'create' && keyword === 'table') {
      const tables = stmt.table as Array<{ table?: string }> | undefined;
      if (tables?.[0]?.table) createdTables.add(tables[0].table);
    }

    if (type === 'transaction') {
      const expr = stmt.expr as Record<string, unknown> | undefined;
      const action = expr?.action as { value?: string } | undefined;
      const val = action?.value?.toLowerCase();
      if (val === 'begin' || val === 'start') inTransaction = true;
      else if (val === 'commit' || val === 'rollback') inTransaction = false;
    }

    const key = stmtKey(stmt);
    if (!key) continue;

    const ctx: GenericRuleContext = {
      report: null as unknown as GenericRuleContext['report'],
      createdTables,
      inTransaction,
      rawSql: sql,
    };

    for (const { ruleId, handlers } of visitors) {
      const handler = handlers[key];
      if (!handler) continue;
      ctx.report = (v) => violations.push({ rule: ruleId, ...v });
      handler(stmt, ctx);
    }
  }

  const endCtx: GenericRuleContext = {
    report: null as unknown as GenericRuleContext['report'],
    createdTables,
    inTransaction,
    rawSql: sql,
  };
  for (const { ruleId, handlers } of visitors) {
    const endHandler = handlers['_End'];
    if (!endHandler) continue;
    endCtx.report = (v) => violations.push({ rule: ruleId, ...v });
    endHandler({}, endCtx);
  }

  return violations;
}
