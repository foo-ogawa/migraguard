import nodeSqlParser from 'node-sql-parser';
const { Parser } = nodeSqlParser;
import type { ObjectRef } from '../deps.js';
import type { GenericDialect } from './engine.js';

function toParserDatabase(dialect: GenericDialect): string {
  return dialect === 'mysql' ? 'MySQL' : 'SQLite';
}

export function analyzeGenericSql(
  sql: string,
  dialect: GenericDialect,
): { creates: ObjectRef[]; references: ObjectRef[] } {
  const creates: ObjectRef[] = [];
  const references: ObjectRef[] = [];
  const createdTableNames = new Set<string>();

  const parser = new Parser();
  let stmts: Array<Record<string, unknown>>;
  try {
    const ast = parser.astify(sql, { database: toParserDatabase(dialect) });
    stmts = (Array.isArray(ast) ? ast : [ast]) as unknown as Array<Record<string, unknown>>;
  } catch {
    return { creates, references };
  }

  for (const stmt of stmts) {
    const type = stmt.type as string;
    const keyword = stmt.keyword as string | undefined;

    if (type === 'create' && keyword === 'table') {
      extractCreateTable(stmt, creates, references, createdTableNames);
    } else if (type === 'create' && keyword === 'index') {
      extractCreateIndex(stmt, references);
    } else if (type === 'alter') {
      extractAlter(stmt, references);
    } else if (type === 'create' && keyword === 'view') {
      extractCreateView(stmt, creates, references);
    } else if (type === 'drop') {
      extractDrop(stmt, references);
    }
  }

  const filteredRefs = references.filter(
    (ref) => !createdTableNames.has(ref.name),
  );
  return { creates, references: filteredRefs };
}

function tableName(table: { db?: string | null; table?: string } | undefined): string {
  if (!table?.table) return '';
  if (table.db) return `${table.db}.${table.table}`;
  return table.table;
}

function extractCreateTable(
  stmt: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
  createdTableNames: Set<string>,
): void {
  const tables = stmt.table as Array<{ db?: string | null; table?: string }> | undefined;
  const name = tableName(tables?.[0]);
  if (!name) return;

  creates.push({ type: 'table', name });
  createdTableNames.add(name);

  const defs = stmt.create_definitions as Array<Record<string, unknown>> | undefined;
  if (!defs) return;

  for (const def of defs) {
    if (def.resource === 'column') {
      extractColumnFk(def, references);
    }
    if (def.constraint_type === 'FOREIGN KEY') {
      extractFkRef(def, references);
    }
  }
}

function extractColumnFk(
  colDef: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const refDef = colDef.reference_definition as Record<string, unknown> | undefined;
  if (!refDef) return;
  extractFkRef(refDef, references);
}

function extractFkRef(
  def: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const refDef = def.reference_definition ?? def;
  const refTables = (refDef as Record<string, unknown>).table as Array<{ db?: string | null; table?: string }> | undefined;
  const name = tableName(refTables?.[0]);
  if (name) {
    references.push({ type: 'table', name });
  }
}

function extractCreateIndex(
  stmt: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const table = stmt.table as { db?: string | null; table?: string } | undefined;
  const name = tableName(table);
  if (name) {
    references.push({ type: 'table', name });
  }
}

function extractAlter(
  stmt: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const tables = stmt.table as Array<{ db?: string | null; table?: string }> | undefined;
  const name = tableName(tables?.[0]);
  if (name) {
    references.push({ type: 'table', name });
  }

  const exprs = stmt.expr as Array<Record<string, unknown>> | undefined;
  if (!exprs) return;

  for (const expr of exprs) {
    if (expr.action === 'add' && expr.resource === 'constraint') {
      const createDefs = expr.create_definitions as Record<string, unknown> | undefined;
      if (createDefs) {
        extractFkRef(createDefs, references);
      }
    }
    if (expr.action === 'add' && expr.resource === 'column') {
      extractColumnFk(expr, references);
    }
  }
}

function extractCreateView(
  stmt: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): void {
  const view = stmt.view as { db?: string | null; view?: string } | undefined;
  if (view?.view) {
    creates.push({ type: 'view', name: view.view });
  }

  const select = stmt.select as Record<string, unknown> | undefined;
  if (select) {
    collectFromTables(select, references);
  }
}

function collectFromTables(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const from = node.from as Array<Record<string, unknown>> | undefined;
  if (from) {
    for (const entry of from) {
      const name = entry.table as string | undefined;
      if (name) {
        references.push({ type: 'table', name });
      }
    }
  }
}

function extractDrop(
  stmt: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const keyword = stmt.keyword as string | undefined;
  let objType: ObjectRef['type'] = 'table';
  if (keyword === 'table') objType = 'table';
  else if (keyword === 'view') objType = 'view';
  else if (keyword === 'index') objType = 'index';
  else return;

  const names = stmt.name as Array<{ db?: string | null; table?: string }> | undefined;
  if (!names) return;

  for (const entry of names) {
    const name = tableName(entry);
    if (name) {
      references.push({ type: objType, name });
    }
  }
}
