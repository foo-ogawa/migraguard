import type { LintRule } from './engine.js';

export const banAlterEnumInTransaction: LintRule = {
  id: 'ban-alter-enum-in-transaction',
  description: 'ALTER TYPE ... ADD VALUE cannot safely run inside a transaction',
  create() {
    return {
      AlterEnumStmt(node, ctx) {
        if (!ctx.inTransaction) return;
        const typeNames = node.typeName as Array<{ String?: { sval?: string } }> | undefined;
        const typeName = typeNames?.map((t) => t.String?.sval).filter(Boolean).join('.') ?? '(unknown)';
        ctx.report({
          message: `ALTER TYPE "${typeName}" ADD VALUE inside a transaction`,
          hint: 'ALTER TYPE ... ADD VALUE cannot be rolled back. Move it outside BEGIN...COMMIT',
        });
      },
    };
  },
};
