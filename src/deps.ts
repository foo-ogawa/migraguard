import { readFile } from 'node:fs/promises';
import { parsePlPgSql, parseStatements, statementText } from './sql-ast.js';
import type { RawStatementEntry } from './sql-ast.js';
import type { MigraguardConfig } from './config.js';
import { scanMigrations } from './scanner.js';
import type { MigrationFile } from './scanner.js';
import type { Phase } from './naming.js';
import { analyzeGenericSql } from './generic/deps.js';
import type { GenericDialect } from './generic/engine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObjectRef {
  type:
    | 'table'
    | 'view'
    | 'sequence'
    | 'function'
    | 'index'
    | 'type'
    | 'role'
    | 'schema'
    | 'database';
  name: string;
}

/**
 * PostgreSQL resolves names per namespace: every relation (table, view,
 * sequence, index) lives in pg_class, while functions, types, schemas,
 * databases and roles each have their own. Objects are matched across files
 * by namespace and name, so a role never binds to a table of the same name.
 */
const OBJECT_NAMESPACES: Record<ObjectRef['type'], string> = {
  table: 'relation',
  view: 'relation',
  sequence: 'relation',
  index: 'relation',
  function: 'function',
  type: 'type',
  role: 'role',
  schema: 'schema',
  database: 'database',
};

export function objectKey(ref: ObjectRef): string {
  return `${OBJECT_NAMESPACES[ref.type]}:${ref.name}`;
}

export interface FileDeps {
  fileName: string;
  creates: ObjectRef[];
  references: ObjectRef[];
  /**
   * Statements the analyzer cannot read through: a `DO $$ ... $$` body the
   * PL/pgSQL parser rejects, or a dynamic `EXECUTE` inside one, whose SQL
   * exists only at run time.
   */
  unanalyzedBlocks: number;
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

export async function analyzeSql(
  sql: string,
): Promise<{ creates: ObjectRef[]; references: ObjectRef[]; unanalyzedBlocks: number }> {
  const creates: ObjectRef[] = [];
  const references: ObjectRef[] = [];
  let unanalyzedBlocks = 0;

  const stmts = await parseStatements(sql);
  if (!stmts) {
    return { creates, references, unanalyzedBlocks };
  }

  for (const entry of stmts) {
    const s = entry.stmt;
    if ('CreateStmt' in s) {
      extractCreateStmt(s.CreateStmt, creates, references);
    } else if ('IndexStmt' in s) {
      extractIndexStmt(s.IndexStmt, references);
    } else if ('AlterTableStmt' in s) {
      extractAlterTableStmt(s.AlterTableStmt, references);
    } else if ('ViewStmt' in s) {
      extractViewStmt(s.ViewStmt, creates, references);
    } else if ('DropStmt' in s) {
      extractDropStmt(s.DropStmt, references);
    } else if ('CreateFunctionStmt' in s) {
      unanalyzedBlocks += await extractCreateFunctionStmt(s.CreateFunctionStmt, creates, references);
    } else if ('CreateSchemaStmt' in s) {
      extractCreateSchemaStmt(s.CreateSchemaStmt, creates, references);
    } else if ('GrantStmt' in s) {
      extractGrantStmt(s.GrantStmt, references);
    } else if ('GrantRoleStmt' in s) {
      extractGrantRoleStmt(s.GrantRoleStmt, references);
    } else if ('AlterDefaultPrivilegesStmt' in s) {
      extractAlterDefaultPrivilegesStmt(s.AlterDefaultPrivilegesStmt, references);
    } else if ('CreateRoleStmt' in s) {
      extractCreateRoleStmt(s.CreateRoleStmt, creates, references);
    } else if ('AlterRoleStmt' in s) {
      pushRoleRef(s.AlterRoleStmt.role, references);
      extractRoleMemberOptions(s.AlterRoleStmt.options, references);
    } else if ('AlterRoleSetStmt' in s) {
      pushRoleRef(s.AlterRoleSetStmt.role, references);
    } else if ('DropRoleStmt' in s) {
      pushRoleRefs(s.DropRoleStmt.roles, references);
    } else if ('AlterOwnerStmt' in s) {
      pushRoleRef(s.AlterOwnerStmt.newowner, references);
    } else if ('DoStmt' in s) {
      unanalyzedBlocks += await extractDoStmt(sql, entry, creates, references);
    }
  }

  const createdKeys = new Set(creates.map(objectKey));
  const filteredRefs = references.filter(
    (ref) => !createdKeys.has(objectKey(ref)),
  );

  return { creates, references: filteredRefs, unanalyzedBlocks };
}

function extractCreateStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): void {
  const rel = node.relation as { relname?: string; schemaname?: string } | undefined;
  if (!rel?.relname) return;

  creates.push({ type: 'table', name: normalizeTableName(rel.relname, rel.schemaname) });

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

    if (alterCmd.newowner) {
      pushRoleRef(alterCmd.newowner, references);
    }

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

/**
 * Fields holding a RangeVar directly rather than wrapped in a `RangeVar` node.
 * The parse tree wraps a node only where the C struct declares a generic
 * `Node *`; a typed `RangeVar *` field is serialized bare, which is how INSERT,
 * UPDATE and DELETE carry their target table.
 */
const BARE_RANGE_VAR_FIELDS = new Set(['relation', 'rel']);

function collectRangeVarsFromNode(
  node: unknown,
  references: ObjectRef[],
): void {
  if (node === null || node === undefined || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  if ('RangeVar' in obj) {
    pushRangeVar(obj.RangeVar, references);
  }

  for (const [key, value] of Object.entries(obj)) {
    if (BARE_RANGE_VAR_FIELDS.has(key)) {
      pushRangeVar(value, references);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectRangeVarsFromNode(item, references);
      }
    } else if (typeof value === 'object' && value !== null) {
      collectRangeVarsFromNode(value, references);
    }
  }
}

function pushRangeVar(node: unknown, references: ObjectRef[]): void {
  const rv = node as { relname?: string; schemaname?: string } | undefined;
  if (!rv?.relname) return;

  references.push({
    type: 'table',
    name: normalizeTableName(rv.relname, rv.schemaname),
  });
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
    const name = qualifiedName(list?.items);
    if (name) {
      references.push({ type: objType, name });
    }
  }
}

/** Reads a dotted object name from a list of String nodes. */
function qualifiedName(
  items: Array<Record<string, unknown>> | undefined,
): string | undefined {
  if (!items) return undefined;

  const names = items
    .map((item) => {
      const s = item.String as { sval?: string } | undefined;
      return s?.sval;
    })
    .filter((n): n is string => !!n);

  if (names.length === 0) return undefined;
  return names.length > 1 && names[0] !== 'public'
    ? names.join('.')
    : names[names.length - 1];
}

/**
 * PostgreSQL resolves the names in a `LANGUAGE sql` body when the function is
 * created, so what that body reads is a dependency of the file — the same rule
 * that makes a view depend on the tables it selects from. Bodies in other
 * languages, PL/pgSQL above all, are not resolved until the function runs and
 * name nothing the file depends on.
 *
 * Returns the number of bodies that stayed unreadable.
 */
async function extractCreateFunctionStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): Promise<number> {
  const name = qualifiedName(node.funcname as Array<Record<string, unknown>> | undefined);
  if (name) {
    creates.push({ type: 'function', name });
  }

  // A BEGIN ATOMIC body is parsed along with the statement itself.
  if (node.sql_body) {
    collectRangeVarsFromNode(node.sql_body, references);
    return 0;
  }

  if (functionOption(node, 'language') !== 'sql') return 0;

  const body = functionOption(node, 'as');
  if (body === undefined) return 0;

  const stmts = await parseStatements(body);
  if (!stmts) return 1;

  for (const entry of stmts) {
    collectRangeVarsFromNode(entry.stmt, references);
  }
  return 0;
}

/** Reads a `CREATE FUNCTION` option whose argument is a single string. */
function functionOption(
  node: Record<string, unknown>,
  name: string,
): string | undefined {
  const options = node.options as Array<Record<string, unknown>> | undefined;
  for (const opt of options ?? []) {
    const def = opt.DefElem as { defname?: string; arg?: Record<string, unknown> } | undefined;
    if (def?.defname !== name) continue;

    const direct = (def.arg?.String as { sval?: string } | undefined)?.sval;
    if (direct !== undefined) return direct;

    const items = (def.arg?.List as { items?: Array<Record<string, unknown>> } | undefined)?.items;
    return (items?.[0]?.String as { sval?: string } | undefined)?.sval;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// DO blocks
// ---------------------------------------------------------------------------

/**
 * A `DO` body is PL/pgSQL, not SQL, so the SQL parser hands it over as a
 * string literal. The PL/pgSQL parser reads it and gives back the statements
 * it holds, which are analyzed exactly like top-level SQL — a `DO` block runs
 * at the same moment as the statements around it, so what it touches is a
 * dependency of the file.
 *
 * Returns the number of statements that stayed unreadable.
 */
async function extractDoStmt(
  sql: string,
  entry: RawStatementEntry,
  creates: ObjectRef[],
  references: ObjectRef[],
): Promise<number> {
  const parsed = await parsePlPgSql(statementText(sql, entry));
  if (parsed === null) {
    return 1;
  }

  const body: PlPgSqlBody = { statements: [], dynamic: 0 };
  collectPlPgSqlStatements(parsed, body);

  let unanalyzed = body.dynamic;
  for (const inner of body.statements) {
    const analysis = await analyzeSql(inner);
    creates.push(...analysis.creates);
    references.push(...analysis.references);
    unanalyzed += analysis.unanalyzedBlocks;
  }

  return unanalyzed;
}

interface PlPgSqlBody {
  statements: string[];
  dynamic: number;
}

/**
 * PL/pgSQL carries the SQL it runs as text. `EXECUTE` is the exception: its
 * statement is built at run time, so it stays unreadable.
 */
function collectPlPgSqlStatements(node: unknown, out: PlPgSqlBody): void {
  if (node === null || node === undefined || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;

  if ('PLpgSQL_stmt_dynexecute' in obj) {
    out.dynamic++;
    return;
  }

  const expr = obj.PLpgSQL_expr as { query?: string } | undefined;
  if (expr?.query) {
    out.statements.push(expr.query);
  }

  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) collectPlPgSqlStatements(item, out);
    } else if (typeof value === 'object' && value !== null) {
      collectPlPgSqlStatements(value, out);
    }
  }
}

// ---------------------------------------------------------------------------
// Schemas, privileges and roles
// ---------------------------------------------------------------------------

function extractCreateSchemaStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): void {
  const name = node.schemaname as string | undefined;
  if (name) {
    creates.push({ type: 'schema', name });
  }
  pushRoleRef(node.authrole, references);
}

/** Object kinds a GRANT/REVOKE target maps to in the dependency graph. */
const GRANT_OBJECT_TYPES: Record<string, ObjectRef['type']> = {
  OBJECT_TABLE: 'table',
  OBJECT_SEQUENCE: 'sequence',
  OBJECT_FUNCTION: 'function',
  OBJECT_PROCEDURE: 'function',
  OBJECT_ROUTINE: 'function',
  OBJECT_TYPE: 'type',
  OBJECT_DOMAIN: 'type',
  OBJECT_SCHEMA: 'schema',
  OBJECT_DATABASE: 'database',
};

/**
 * GRANT and REVOKE share this node (`is_grant` tells them apart); both need
 * the target object and the grantee role to exist already, so both sides are
 * references.
 */
function extractGrantStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const objects = node.objects as Array<Record<string, unknown>> | undefined;
  const objType = GRANT_OBJECT_TYPES[node.objtype as string];

  if (objects && objType) {
    const allInSchema = node.targtype === 'ACL_TARGET_ALL_IN_SCHEMA';
    for (const obj of objects) {
      if (allInSchema) {
        // GRANT ... ON ALL TABLES IN SCHEMA app: the object list holds schemas.
        pushSchemaRef(obj, references);
      } else {
        pushGrantObjectRef(obj, objType, references);
      }
    }
  }

  pushRoleRefs(node.grantees, references);
}

function pushGrantObjectRef(
  obj: Record<string, unknown>,
  objType: ObjectRef['type'],
  references: ObjectRef[],
): void {
  const rel = obj.RangeVar as { relname?: string; schemaname?: string } | undefined;
  if (rel?.relname) {
    references.push({ type: objType, name: normalizeTableName(rel.relname, rel.schemaname) });
    return;
  }

  const withArgs = obj.ObjectWithArgs as { objname?: Array<Record<string, unknown>> } | undefined;
  const list = obj.List as { items?: Array<Record<string, unknown>> } | undefined;
  const name = qualifiedName(withArgs?.objname ?? list?.items)
    ?? (obj.String as { sval?: string } | undefined)?.sval;
  if (name) {
    references.push({ type: objType, name });
  }
}

function pushSchemaRef(obj: Record<string, unknown>, references: ObjectRef[]): void {
  const name = (obj.String as { sval?: string } | undefined)?.sval;
  if (name) {
    references.push({ type: 'schema', name });
  }
}

function extractAlterDefaultPrivilegesStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const options = node.options as Array<Record<string, unknown>> | undefined;
  for (const opt of options ?? []) {
    const def = opt.DefElem as { defname?: string; arg?: Record<string, unknown> } | undefined;
    const items = (def?.arg?.List as { items?: Array<Record<string, unknown>> } | undefined)?.items;
    if (!items) continue;

    if (def?.defname === 'schemas') {
      for (const item of items) pushSchemaRef(item, references);
    } else if (def?.defname === 'roles') {
      pushRoleRefs(items, references);
    }
  }

  const action = node.action as Record<string, unknown> | undefined;
  if (action) {
    extractGrantStmt(action, references);
  }
}

function extractCreateRoleStmt(
  node: Record<string, unknown>,
  creates: ObjectRef[],
  references: ObjectRef[],
): void {
  const role = node.role as string | undefined;
  if (role) {
    creates.push({ type: 'role', name: role });
  }
  extractRoleMemberOptions(node.options, references);
}

/** CREATE/ALTER ROLE options that name roles which must already exist. */
const ROLE_MEMBER_OPTIONS = new Set(['addroleto', 'rolemembers', 'adminmembers']);

function extractRoleMemberOptions(options: unknown, references: ObjectRef[]): void {
  if (!Array.isArray(options)) return;

  for (const opt of options) {
    const def = (opt as Record<string, unknown>).DefElem as
      { defname?: string; arg?: Record<string, unknown> } | undefined;
    if (!def?.defname || !ROLE_MEMBER_OPTIONS.has(def.defname)) continue;

    const list = def.arg?.List as { items?: unknown[] } | undefined;
    pushRoleRefs(list?.items, references);
  }
}

function extractGrantRoleStmt(
  node: Record<string, unknown>,
  references: ObjectRef[],
): void {
  const granted = node.granted_roles as Array<Record<string, unknown>> | undefined;
  for (const g of granted ?? []) {
    const priv = g.AccessPriv as { priv_name?: string } | undefined;
    if (priv?.priv_name) {
      references.push({ type: 'role', name: priv.priv_name });
    }
  }

  pushRoleRefs(node.grantee_roles, references);
}

function pushRoleRefs(nodes: unknown, references: ObjectRef[]): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    pushRoleRef(node, references);
  }
}

/**
 * Accepts either a wrapped `{ RoleSpec: … }` list item or a bare RoleSpec
 * field. PUBLIC, CURRENT_USER and friends name no migration object.
 */
function pushRoleRef(node: unknown, references: ObjectRef[]): void {
  if (!node || typeof node !== 'object') return;

  const wrapper = node as Record<string, unknown>;
  const spec = ('RoleSpec' in wrapper ? wrapper.RoleSpec : wrapper) as
    { roletype?: string; rolename?: string } | undefined;

  if (spec?.roletype !== 'ROLESPEC_CSTRING' || !spec.rolename) return;
  references.push({ type: 'role', name: spec.rolename });
}

// ---------------------------------------------------------------------------
// Explicit dependency parsing — comments and config
// ---------------------------------------------------------------------------

export interface ExplicitDep {
  target: string;
  phase?: Phase;
}

const DEPENDS_ON_PATTERN = /^--\s*migraguard:depends-on\s+(\S+)/gm;
const VALID_PHASES: Set<string> = new Set(['expand', 'backfill', 'switch', 'contract']);

export function parseExplicitDepsFromSql(sql: string): ExplicitDep[] {
  const deps: ExplicitDep[] = [];
  let match: RegExpExecArray | null;
  while ((match = DEPENDS_ON_PATTERN.exec(sql)) !== null) {
    const raw = match[1];
    const colonIdx = raw.lastIndexOf(':');
    if (colonIdx > 0) {
      const maybePath = raw.substring(0, colonIdx);
      const maybePhase = raw.substring(colonIdx + 1);
      if (VALID_PHASES.has(maybePhase)) {
        deps.push({ target: maybePath, phase: maybePhase as Phase });
        continue;
      }
    }
    deps.push({ target: raw });
  }
  DEPENDS_ON_PATTERN.lastIndex = 0;
  return deps;
}

/** Legacy compat: returns just the target strings for existing callers */
export function parseExplicitDepTargetsFromSql(sql: string): string[] {
  return parseExplicitDepsFromSql(sql).map((d) => d.target);
}

export function parseExplicitDepsFromConfig(
  config: MigraguardConfig,
): Map<string, string[]> {
  const deps = config.dependencies;
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

export async function analyzeFile(filePath: string, fileName: string, dialect?: string): Promise<FileDeps> {
  const sql = await readFile(filePath, 'utf-8');
  const analysis = dialect && dialect !== 'postgresql'
    ? { ...analyzeGenericSql(sql, dialect as GenericDialect), unanalyzedBlocks: 0 }
    : await analyzeSql(sql);
  return { fileName, ...analysis };
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
    const deps = await analyzeFile(file.filePath, file.fileName, config.dialect);
    fileDeps.set(file.fileName, deps);
  }

  const objectCreators = new Map<string, string>();
  for (const [fileName, deps] of fileDeps) {
    for (const obj of deps.creates) {
      objectCreators.set(objectKey(obj), fileName);
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
      const creator = objectCreators.get(objectKey(ref));
      if (creator && creator !== file.fileName) {
        const key = `${file.fileName}->${creator}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: file.fileName, to: creator, via: ref.name });
        }
      }
    }

    for (const dep of explicitDeps) {
      let resolvedTarget = dep.target;

      if (!fileNames.includes(resolvedTarget)) {
        const expandFile = fileNames.find(
          (f) => f.startsWith(resolvedTarget + '/') && f.endsWith('_expand.sql'),
        );
        if (expandFile) {
          resolvedTarget = expandFile;
        }
      }

      if (fileNames.includes(resolvedTarget) && resolvedTarget !== file.fileName) {
        const via = dep.phase ? `(explicit:${dep.phase})` : '(explicit)';
        const key = `${file.fileName}->${resolvedTarget}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: file.fileName, to: resolvedTarget, via });
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
