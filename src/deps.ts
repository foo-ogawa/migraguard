import { readFile } from 'node:fs/promises';
import libpg from 'libpg-query';
import type { MigraguardConfig, RawConfig } from './config.js';
import { scanMigrations } from './scanner.js';
import type { MigrationFile } from './scanner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObjectRef {
  type: 'table' | 'view' | 'sequence' | 'function' | 'index' | 'type';
  name: string;
}

export interface FileDeps {
  fileName: string;
  creates: ObjectRef[];
  references: ObjectRef[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  via: string;
}

export interface DependencyGraph {
  files: string[];
  edges: DependencyEdge[];
  fileDeps: Map<string, FileDeps>;
}

export interface CycleError {
  cycle: string[];
}

// ---------------------------------------------------------------------------
// SQL AST analysis — extract created and referenced objects
// ---------------------------------------------------------------------------

function normalizeTableName(name: string | undefined, schema: string | undefined): string {
  if (!name) return '';
  if (schema && schema !== 'public') {
    return `${schema}.${name}`;
  }
  return name;
}

export async function analyzeSql(sql: string): Promise<{ creates: ObjectRef[]; references: ObjectRef[] }> {
  const creates: ObjectRef[] = [];
  const references: ObjectRef[] = [];
  const createdTableNames = new Set<string>();

  let stmts;
  try {
    const ast = await libpg.parse(sql);
    stmts = ast.stmts;
  } catch {
    return { creates, references };
  }

  for (const { stmt } of stmts) {
    const s = stmt as Record<string, Record<string, unknown>>;
    if ('CreateStmt' in s) {
      extractCreateStmt(s.CreateStmt, creates, references, createdTableNames);
    } else if ('IndexStmt' in s) {
      extractIndexStmt(s.IndexStmt, references);
    } else if ('AlterTableStmt' in s) {
      extractAlterTableStmt(s.AlterTableStmt, references);
    } else if ('ViewStmt' in s) {
      extractViewStmt(s.ViewStmt, creates, references);
    } else if ('DropStmt' in s) {
      extractDropStmt(s.DropStmt, references);
    } else if ('CreateFunctionStmt' in s) {
      extractCreateFunctionStmt(s.CreateFunctionStmt, creates);
    }
  }

  const filteredRefs = references.filter(
    (ref) => !createdTableNames.has(ref.name),
  );

  return { creates, references: filteredRefs };
}

function extractCreateStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
  createdTableNames: Set<string>,
): void {
  const rel = node.relation as { relname?: string; schemaname?: string } | undefined;
  if (!rel?.relname) return;

  const tableName = normalizeTableName(rel.relname, rel.schemaname);
  creates.push({ type: 'table', name: tableName });
  createdTableNames.add(tableName);

  const tableElts = node.tableElts as Array<Record<string, unknown>> | undefined;
  if (!tableElts) return;

  for (const elt of tableElts) {
    if (elt.ColumnDef) {
      extractColumnDefConstraints(
        elt.ColumnDef as Record<string, unknown>,
        references,
      );
    }
    if (elt.Constraint) {
      extractConstraintRef(elt.Constraint as Record<string, unknown>, references);
    }
  }
}

function extractColumnDefConstraints(
  colDef: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const constraints = colDef.constraints as Array<Record<string, unknown>> | undefined;
  if (!constraints) return;

  for (const c of constraints) {
    if (c.Constraint) {
      extractConstraintRef(c.Constraint as Record<string, unknown>, references);
    }
  }
}

function extractConstraintRef(
  constraint: Record<string, unknown>,
  references: ObjectRef[],
): void {
  if (constraint.contype !== 'CONSTR_FOREIGN') return;

  const pktable = constraint.pktable as { relname?: string; schemaname?: string } | undefined;
  if (pktable?.relname) {
    const refName = normalizeTableName(pktable.relname, pktable.schemaname);
    references.push({ type: 'table', name: refName });
  }
}

function extractIndexStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const rel = node.relation as { relname?: string; schemaname?: string } | undefined;
  if (rel?.relname) {
    references.push({
      type: 'table',
      name: normalizeTableName(rel.relname, rel.schemaname),
    });
  }
}

function extractAlterTableStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const rel = node.relation as { relname?: string; schemaname?: string } | undefined;
  if (rel?.relname) {
    references.push({
      type: 'table',
      name: normalizeTableName(rel.relname, rel.schemaname),
    });
  }

  const cmds = node.cmds as Array<Record<string, unknown>> | undefined;
  if (!cmds) return;

  for (const cmd of cmds) {
    const alterCmd = cmd.AlterTableCmd as Record<string, unknown> | undefined;
    if (!alterCmd) continue;

    const def = alterCmd.def as Record<string, unknown> | undefined;
    if (!def) continue;

    if (def.Constraint) {
      extractConstraintRef(def.Constraint as Record<string, unknown>, references);
    }
    if (def.ColumnDef) {
      extractColumnDefConstraints(
        def.ColumnDef as Record<string, unknown>,
        references,
      );
    }
  }
}

function extractViewStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): void {
  const view = node.view as { relname?: string; schemaname?: string } | undefined;
  if (view?.relname) {
    creates.push({
      type: 'view',
      name: normalizeTableName(view.relname, view.schemaname),
    });
  }

  const query = node.query;
  if (query) {
    collectRangeVarsFromNode(query, references);
  }
}

function collectRangeVarsFromNode(
  node: unknown,
  references: ObjectRef[],
): void {
  if (node === null || node === undefined || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  if ('RangeVar' in obj) {
    const rv = obj.RangeVar as { relname?: string; schemaname?: string };
    if (rv?.relname) {
      references.push({
        type: 'table',
        name: normalizeTableName(rv.relname, rv.schemaname),
      });
    }
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectRangeVarsFromNode(item, references);
      }
    } else if (typeof value === 'object' && value !== null) {
      collectRangeVarsFromNode(value, references);
    }
  }
}

function extractDropStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const removeType = node.removeType as string | undefined;
  const objects = node.objects as Array<Record<string, unknown>> | undefined;
  if (!objects) return;

  let objType: ObjectRef['type'] = 'table';
  if (removeType === 'OBJECT_TABLE') objType = 'table';
  else if (removeType === 'OBJECT_VIEW') objType = 'view';
  else if (removeType === 'OBJECT_INDEX') objType = 'index';
  else if (removeType === 'OBJECT_SEQUENCE') objType = 'sequence';
  else if (removeType === 'OBJECT_FUNCTION') objType = 'function';
  else if (removeType === 'OBJECT_TYPE') objType = 'type';

  for (const obj of objects) {
    const list = obj.List as { items?: Array<Record<string, unknown>> } | undefined;
    if (list?.items) {
      const names = list.items
        .map((item) => {
          const s = item.String as { sval?: string } | undefined;
          return s?.sval;
        })
        .filter((n): n is string => !!n);

      if (names.length > 0) {
        const name = names.length > 1 && names[0] !== 'public'
          ? names.join('.')
          : names[names.length - 1];
        references.push({ type: objType, name });
      }
    }
  }
}

function extractCreateFunctionStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
): void {
  const funcname = node.funcname as Array<Record<string, unknown>> | undefined;
  if (!funcname) return;

  const names = funcname
    .map((item) => {
      const s = item.String as { sval?: string } | undefined;
      return s?.sval;
    })
    .filter((n): n is string => !!n);

  if (names.length > 0) {
    const name = names.length > 1 && names[0] !== 'public'
      ? names.join('.')
      : names[names.length - 1];
    creates.push({ type: 'function', name });
  }
}

// ---------------------------------------------------------------------------
// Explicit dependency parsing — comments and config
// ---------------------------------------------------------------------------

const DEPENDS_ON_PATTERN = /^--\s*migraguard:depends-on\s+(\S+)/gm;

export function parseExplicitDepsFromSql(sql: string): string[] {
  const deps: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = DEPENDS_ON_PATTERN.exec(sql)) !== null) {
    deps.push(match[1]);
  }
  DEPENDS_ON_PATTERN.lastIndex = 0;
  return deps;
}

export function parseExplicitDepsFromConfig(
  config: MigraguardConfig,
): Map<string, string[]> {
  const raw = config as unknown as RawConfig & { dependencies?: Record<string, string[]> };
  const deps = raw.dependencies;
  if (!deps || typeof deps !== 'object') return new Map();

  const result = new Map<string, string[]>();
  for (const [file, fileDeps] of Object.entries(deps)) {
    if (Array.isArray(fileDeps)) {
      result.set(file, fileDeps.filter((d) => typeof d === 'string'));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Analyze a single migration file
// ---------------------------------------------------------------------------

export async function analyzeFile(filePath: string, fileName: string): Promise<FileDeps> {
  const sql = await readFile(filePath, 'utf-8');
  const { creates, references } = await analyzeSql(sql);
  return { fileName, creates, references };
}

// ---------------------------------------------------------------------------
// DAG construction
// ---------------------------------------------------------------------------

export async function buildDependencyGraph(
  config: MigraguardConfig,
): Promise<DependencyGraph> {
  const files = await scanMigrations(config);
  return buildDependencyGraphFromFiles(files, config);
}

export async function buildDependencyGraphFromFiles(
  files: MigrationFile[],
  config: MigraguardConfig,
): Promise<DependencyGraph> {
  const fileNames = files.map((f) => f.fileName);
  const fileDeps = new Map<string, FileDeps>();

  for (const file of files) {
    const deps = await analyzeFile(file.filePath, file.fileName);
    fileDeps.set(file.fileName, deps);
  }

  const objectCreators = new Map<string, string>();
  for (const [fileName, deps] of fileDeps) {
    for (const obj of deps.creates) {
      objectCreators.set(obj.name, fileName);
    }
  }

  const configDeps = parseExplicitDepsFromConfig(config);

  const edges: DependencyEdge[] = [];
  const edgeSet = new Set<string>();

  for (const file of files) {
    const deps = fileDeps.get(file.fileName);
    if (!deps) continue;

    const sql = await readFile(file.filePath, 'utf-8');
    const explicitDeps = parseExplicitDepsFromSql(sql);

    for (const ref of deps.references) {
      const creator = objectCreators.get(ref.name);
      if (creator && creator !== file.fileName) {
        const key = `${file.fileName}->${creator}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: file.fileName, to: creator, via: ref.name });
        }
      }
    }

    for (const dep of explicitDeps) {
      if (fileNames.includes(dep) && dep !== file.fileName) {
        const key = `${file.fileName}->${dep}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: file.fileName, to: dep, via: '(explicit)' });
        }
      }
    }

    const configFileDeps = configDeps.get(file.fileName);
    if (configFileDeps) {
      for (const dep of configFileDeps) {
        if (fileNames.includes(dep) && dep !== file.fileName) {
          const key = `${file.fileName}->${dep}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ from: file.fileName, to: dep, via: '(config)' });
          }
        }
      }
    }
  }

  return { files: fileNames, edges, fileDeps };
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

export function detectCycles(graph: DependencyGraph): CycleError[] {
  const adjacency = new Map<string, string[]>();
  for (const file of graph.files) {
    adjacency.set(file, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const file of graph.files) {
    color.set(file, WHITE);
  }

  const cycles: CycleError[] = [];

  function dfs(node: string, path: string[]): void {
    color.set(node, GRAY);
    path.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      const c = color.get(neighbor);
      if (c === GRAY) {
        const cycleStart = path.indexOf(neighbor);
        cycles.push({ cycle: [...path.slice(cycleStart), neighbor] });
      } else if (c === WHITE) {
        dfs(neighbor, path);
      }
    }

    path.pop();
    color.set(node, BLACK);
  }

  for (const file of graph.files) {
    if (color.get(file) === WHITE) {
      dfs(file, []);
    }
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Topological sort (for future use in Phase 3 apply)
// ---------------------------------------------------------------------------

export function topologicalSort(graph: DependencyGraph): string[] | null {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const file of graph.files) {
    inDegree.set(file, 0);
    adjacency.set(file, []);
  }

  for (const edge of graph.edges) {
    adjacency.get(edge.to)?.push(edge.from);
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [file, degree] of inDegree) {
    if (degree === 0) queue.push(file);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    queue.sort();
    const node = queue.shift()!;
    sorted.push(node);

    for (const dependent of adjacency.get(node) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== graph.files.length) return null;
  return sorted;
}

// ---------------------------------------------------------------------------
// Leaf nodes (files that no other file depends on)
// ---------------------------------------------------------------------------

export function findLeafNodes(graph: DependencyGraph): string[] {
  const dependedOn = new Set<string>();
  for (const edge of graph.edges) {
    dependedOn.add(edge.to);
  }
  return graph.files.filter((f) => !dependedOn.has(f));
}

// ---------------------------------------------------------------------------
// Transitive dependents (all files that transitively depend on a given file)
// ---------------------------------------------------------------------------

export function findTransitiveDependents(graph: DependencyGraph, file: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const f of graph.files) {
    childrenOf.set(f, []);
  }
  for (const edge of graph.edges) {
    childrenOf.get(edge.to)?.push(edge.from);
  }

  const result = new Set<string>();
  const queue = [file];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}
