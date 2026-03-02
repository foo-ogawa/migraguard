import libpg from 'libpg-query';

export interface LintViolation {
  rule: string;
  severity: 'error' | 'warn';
  message: string;
  hint: string;
}

export interface RuleReport {
  message: string;
  hint: string;
}

export interface RuleContext {
  report(violation: RuleReport): void;
  createdTables: ReadonlySet<string>;
  lockTimeoutSet: boolean;
  inTransaction: boolean;
}

export interface RawViolation {
  rule: string;
  message: string;
  hint: string;
}

type NodeHandler = (node: Record<string, unknown>, ctx: RuleContext) => void;

export type NodeVisitors = Record<string, NodeHandler | undefined>;

export interface LintRule {
  id: string;
  description: string;
  create(): NodeVisitors;
}

const ALLOW_DIRECTIVE_RE = /^--\s*migraguard:allow\s+(.+)$/gm;

export function parseAllowDirectives(sql: string): Set<string> {
  const allowed = new Set<string>();
  let match;
  while ((match = ALLOW_DIRECTIVE_RE.exec(sql)) !== null) {
    for (const id of match[1].split(/[,\s]+/).filter(Boolean)) {
      allowed.add(id);
    }
  }
  return allowed;
}

export async function runRules(
  sql: string,
  rules: LintRule[],
): Promise<RawViolation[]> {
  const violations: RawViolation[] = [];

  const allowed = parseAllowDirectives(sql);
  const activeRules = rules.filter((r) => !allowed.has(r.id));
  if (activeRules.length === 0) return violations;

  let stmts;
  try {
    const ast = await libpg.parse(sql);
    stmts = ast.stmts;
  } catch {
    return violations;
  }

  const visitors: Array<{ ruleId: string; handlers: NodeVisitors }> = [];
  for (const rule of activeRules) {
    visitors.push({ ruleId: rule.id, handlers: rule.create() });
  }

  const createdTables = new Set<string>();
  let lockTimeoutSet = false;
  let inTransaction = false;

  for (const { stmt } of stmts) {
    const s = stmt as Record<string, Record<string, unknown>>;

    if ('VariableSetStmt' in s) {
      const name = s.VariableSetStmt.name as string | undefined;
      if (name === 'lock_timeout') lockTimeoutSet = true;
    }

    if ('TransactionStmt' in s) {
      const kind = s.TransactionStmt.kind as string | undefined;
      if (kind === 'TRANS_STMT_BEGIN') inTransaction = true;
      else if (kind === 'TRANS_STMT_COMMIT' || kind === 'TRANS_STMT_ROLLBACK') inTransaction = false;
    }

    if ('CreateStmt' in s) {
      const rel = s.CreateStmt.relation as { relname?: string } | undefined;
      if (rel?.relname) createdTables.add(rel.relname);
    }

    const ctx: RuleContext = {
      report: null as unknown as RuleContext['report'],
      createdTables,
      lockTimeoutSet,
      inTransaction,
    };

    for (const key of Object.keys(s)) {
      const node = s[key];
      for (const { ruleId, handlers } of visitors) {
        const handler = handlers[key];
        if (!handler) continue;
        ctx.report = (v) => violations.push({ rule: ruleId, ...v });
        handler(node, ctx);
      }
    }
  }

  const endCtx: RuleContext = {
    report: null as unknown as RuleContext['report'],
    createdTables,
    lockTimeoutSet,
    inTransaction,
  };
  for (const { ruleId, handlers } of visitors) {
    const endHandler = handlers['_End'];
    if (!endHandler) continue;
    endCtx.report = (v) => violations.push({ rule: ruleId, ...v });
    endHandler({}, endCtx);
  }

  return violations;
}
