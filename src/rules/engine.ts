import libpg from 'libpg-query';

export interface LintViolation {
  rule: string;
  message: string;
  hint: string;
}

export interface RuleContext {
  report(violation: Omit<LintViolation, 'rule'>): void;
  createdTables: ReadonlySet<string>;
  lockTimeoutSet: boolean;
  inTransaction: boolean;
}

export interface NodeVisitors {
  CreateStmt?: (node: Record<string, unknown>, ctx: RuleContext) => void;
  IndexStmt?: (node: Record<string, unknown>, ctx: RuleContext) => void;
  AlterTableStmt?: (node: Record<string, unknown>, ctx: RuleContext) => void;
  DropStmt?: (node: Record<string, unknown>, ctx: RuleContext) => void;
  TransactionStmt?: (node: Record<string, unknown>, ctx: RuleContext) => void;
}

export interface LintRule {
  id: string;
  description: string;
  create(): NodeVisitors;
}

type StmtKey = keyof NodeVisitors;
const VISITOR_KEYS: StmtKey[] = [
  'CreateStmt',
  'IndexStmt',
  'AlterTableStmt',
  'DropStmt',
  'TransactionStmt',
];

export async function runRules(
  sql: string,
  rules: LintRule[],
): Promise<LintViolation[]> {
  const violations: LintViolation[] = [];

  let stmts;
  try {
    const ast = await libpg.parse(sql);
    stmts = ast.stmts;
  } catch {
    return violations;
  }

  const visitors: Array<{ ruleId: string; handlers: NodeVisitors }> = [];
  for (const rule of rules) {
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
      continue;
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

    for (const key of VISITOR_KEYS) {
      if (!(key in s)) continue;
      const node = s[key];
      for (const { ruleId, handlers } of visitors) {
        const handler = handlers[key];
        if (!handler) continue;
        ctx.report = (v) => violations.push({ rule: ruleId, ...v });
        handler(node, ctx);
      }
    }
  }

  return violations;
}
