import { describe, it, expect } from 'vitest';
import {
  analyzeSql,
  parseExplicitDepsFromSql,
  detectCycles,
  topologicalSort,
  findLeafNodes,
  findTransitiveDependents,
} from '../src/deps.js';
import type { DependencyGraph } from '../src/deps.js';

describe('deps — analyzeSql', () => {
  it('extracts table creation from CREATE TABLE', async () => {
    const { creates, references } = await analyzeSql('CREATE TABLE users (id INT);');
    expect(creates).toEqual([{ type: 'table', name: 'users' }]);
    expect(references).toEqual([]);
  });

  it('extracts table creation from CREATE TABLE IF NOT EXISTS', async () => {
    const { creates } = await analyzeSql('CREATE TABLE IF NOT EXISTS users (id INT);');
    expect(creates).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('extracts FK references from column-level REFERENCES', async () => {
    const sql = 'CREATE TABLE posts (id INT, user_id INT REFERENCES users(id));';
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'posts' }]);
    expect(references).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('extracts FK references from table-level FOREIGN KEY', async () => {
    const sql = `CREATE TABLE post_likes (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES posts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );`;
    const { references } = await analyzeSql(sql);
    const refNames = references.map((r) => r.name).sort();
    expect(refNames).toEqual(['posts', 'users']);
  });

  it('does not include self-references in references list', async () => {
    const sql = 'CREATE TABLE nodes (id INT, parent_id INT REFERENCES nodes(id));';
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'nodes' }]);
    expect(references).toEqual([]);
  });

  it('extracts table reference from CREATE INDEX', async () => {
    const sql = 'CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);';
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([]);
    expect(references).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('extracts table reference from ALTER TABLE ADD COLUMN', async () => {
    const sql = 'ALTER TABLE users ADD COLUMN email VARCHAR(256);';
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('extracts FK from ALTER TABLE ADD CONSTRAINT', async () => {
    const sql = 'ALTER TABLE posts ADD CONSTRAINT fk FOREIGN KEY (user_id) REFERENCES users(id);';
    const { references } = await analyzeSql(sql);
    const refNames = references.map((r) => r.name).sort();
    expect(refNames).toEqual(['posts', 'users']);
  });

  it('extracts view creation and FROM references', async () => {
    const sql = 'CREATE VIEW active_users AS SELECT * FROM users WHERE is_active;';
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'view', name: 'active_users' }]);
    expect(references).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('extracts DROP TABLE reference', async () => {
    const sql = 'DROP TABLE IF EXISTS old_users CASCADE;';
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'old_users' }]);
  });

  it('handles multiple statements', async () => {
    const sql = `
      CREATE TABLE users (id INT);
      CREATE TABLE posts (id INT, user_id INT REFERENCES users(id));
      CREATE INDEX idx ON posts (user_id);
    `;
    const { creates, references } = await analyzeSql(sql);
    expect(creates.map((c) => c.name)).toEqual(['users', 'posts']);
    expect(references).toEqual([]);
  });

  it('returns empty for unparseable SQL', async () => {
    const { creates, references } = await analyzeSql('THIS IS NOT VALID SQL !!!');
    expect(creates).toEqual([]);
    expect(references).toEqual([]);
  });

  it('strips public schema prefix', async () => {
    const sql = 'CREATE TABLE public.users (id INT);';
    const { creates } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'users' }]);
  });

  it('preserves non-public schema prefix', async () => {
    const sql = 'CREATE TABLE audit.logs (id INT);';
    const { creates } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'audit.logs' }]);
  });

  it('extracts function creation', async () => {
    const sql = "CREATE FUNCTION my_func() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    const { creates } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'function', name: 'my_func' }]);
  });

  it('extracts tables read by a LANGUAGE sql body', async () => {
    const sql = 'CREATE FUNCTION f() RETURNS int AS $$ SELECT count(*) FROM parent $$ LANGUAGE sql;';
    const { creates, references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'function', name: 'f' }]);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('reads a LANGUAGE sql body written before the AS clause', async () => {
    const sql = 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE SQL AS $$ SELECT count(*) FROM parent $$;';
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
  });

  it('reads a BEGIN ATOMIC body', async () => {
    const sql = 'CREATE FUNCTION f(a int) RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT a + (SELECT count(*) FROM parent); END;';
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'function', name: 'f' }]);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
  });

  it('reads a LANGUAGE sql procedure body', async () => {
    const sql = 'CREATE PROCEDURE p() LANGUAGE sql AS $$ INSERT INTO audit.logs VALUES (1) $$;';
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'audit.logs' }]);
  });

  it('reads every statement of a multi-statement LANGUAGE sql body', async () => {
    const sql = "CREATE FUNCTION f() RETURNS int AS $$ INSERT INTO audit_log VALUES (1); SELECT count(*) FROM parent $$ LANGUAGE sql;";
    const { references } = await analyzeSql(sql);
    expect(references.map((r) => r.name).sort()).toEqual(['audit_log', 'parent']);
  });

  it('leaves a PL/pgSQL body alone, which PostgreSQL does not resolve until it runs', async () => {
    const sql = 'CREATE FUNCTION g() RETURNS void AS $$ BEGIN INSERT INTO parent VALUES (1); END $$ LANGUAGE plpgsql;';
    const { creates, references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'function', name: 'g' }]);
    expect(references).toEqual([]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('does not reference a table the same file creates from a LANGUAGE sql body', async () => {
    const sql = `
      CREATE TABLE parent (id INT);
      CREATE FUNCTION f() RETURNS int AS $$ SELECT count(*) FROM parent $$ LANGUAGE sql;
    `;
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'function', name: 'f' },
    ]);
    expect(references).toEqual([]);
  });

  it('reports a LANGUAGE sql body it cannot parse', async () => {
    const sql = 'CREATE FUNCTION f() RETURNS int AS $$ NOT SQL AT ALL !!! $$ LANGUAGE sql;';
    const { creates, references, unanalyzedBlocks, parseFailures } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'function', name: 'f' }]);
    expect(references).toEqual([]);
    expect(unanalyzedBlocks).toBe(0);
    expect(parseFailures).toEqual(['function f: LANGUAGE sql body does not parse']);
  });

  it('extracts schema creation and its authorization role', async () => {
    const { creates, references } = await analyzeSql('CREATE SCHEMA app AUTHORIZATION owner_role;');
    expect(creates).toEqual([{ type: 'schema', name: 'app' }]);
    expect(references).toEqual([{ type: 'role', name: 'owner_role' }]);
  });

  it('reports no unanalyzed blocks for plain SQL', async () => {
    const { unanalyzedBlocks } = await analyzeSql('CREATE TABLE users (id INT);');
    expect(unanalyzedBlocks).toBe(0);
  });
});

describe('deps — analyzeSql privileges and roles', () => {
  it('extracts the granted table and the grantee role from GRANT', async () => {
    const { creates, references } = await analyzeSql('GRANT SELECT ON parent TO reporting_role;');
    expect(creates).toEqual([]);
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'role', name: 'reporting_role' },
    ]);
  });

  it('extracts the table behind a column-level GRANT', async () => {
    const { references } = await analyzeSql('GRANT SELECT (created_at) ON parent TO reporting_role;');
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'role', name: 'reporting_role' },
    ]);
  });

  it('extracts the target of REVOKE and skips PUBLIC', async () => {
    const { references } = await analyzeSql('REVOKE TEMPORARY ON DATABASE app FROM PUBLIC;');
    expect(references).toEqual([{ type: 'database', name: 'app' }]);
  });

  it('extracts every relation named by a multi-object GRANT', async () => {
    const { references } = await analyzeSql('REVOKE ALL ON TABLE a, b FROM r;');
    expect(references).toEqual([
      { type: 'table', name: 'a' },
      { type: 'table', name: 'b' },
      { type: 'role', name: 'r' },
    ]);
  });

  it('extracts sequence, schema, function and type grants', async () => {
    const sql = `
      GRANT USAGE ON SEQUENCE orders_id_seq TO r;
      GRANT USAGE ON SCHEMA app TO r;
      GRANT EXECUTE ON FUNCTION app.calc(int) TO r;
      GRANT USAGE ON TYPE app.status TO r;
    `;
    const { references } = await analyzeSql(sql);
    expect(references.filter((ref) => ref.type !== 'role')).toEqual([
      { type: 'sequence', name: 'orders_id_seq' },
      { type: 'schema', name: 'app' },
      { type: 'function', name: 'app.calc' },
      { type: 'type', name: 'app.status' },
    ]);
  });

  it('extracts the schema behind GRANT ON ALL TABLES IN SCHEMA', async () => {
    const { references } = await analyzeSql('GRANT SELECT ON ALL TABLES IN SCHEMA app TO r;');
    expect(references).toEqual([
      { type: 'schema', name: 'app' },
      { type: 'role', name: 'r' },
    ]);
  });

  it('keeps the schema qualifier of a granted table', async () => {
    const { references } = await analyzeSql('GRANT SELECT ON audit.logs TO r;');
    expect(references[0]).toEqual({ type: 'table', name: 'audit.logs' });
  });

  it('extracts role creation', async () => {
    const { creates, references } = await analyzeSql('CREATE ROLE reporting_role NOLOGIN INHERIT;');
    expect(creates).toEqual([{ type: 'role', name: 'reporting_role' }]);
    expect(references).toEqual([]);
  });

  it('extracts role creation from CREATE USER', async () => {
    const { creates } = await analyzeSql("CREATE USER app_user WITH PASSWORD 'x';");
    expect(creates).toEqual([{ type: 'role', name: 'app_user' }]);
  });

  it('extracts membership roles named by CREATE ROLE', async () => {
    const { creates, references } = await analyzeSql('CREATE ROLE app_user IN ROLE reporting_role;');
    expect(creates).toEqual([{ type: 'role', name: 'app_user' }]);
    expect(references).toEqual([{ type: 'role', name: 'reporting_role' }]);
  });

  it('extracts both sides of GRANT <role> TO <role>', async () => {
    const { references } = await analyzeSql('GRANT reporting_role TO app_user;');
    expect(references).toEqual([
      { type: 'role', name: 'reporting_role' },
      { type: 'role', name: 'app_user' },
    ]);
  });

  it('extracts the role named by ALTER ROLE, ALTER ROLE SET and DROP ROLE', async () => {
    const sql = `
      ALTER ROLE reporting_role NOLOGIN;
      ALTER ROLE reporting_role SET search_path = app;
      DROP ROLE IF EXISTS reporting_role;
    `;
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([
      { type: 'role', name: 'reporting_role' },
      { type: 'role', name: 'reporting_role' },
      { type: 'role', name: 'reporting_role' },
    ]);
  });

  it('extracts schema and roles from ALTER DEFAULT PRIVILEGES', async () => {
    const sql = 'ALTER DEFAULT PRIVILEGES FOR ROLE owner_role IN SCHEMA app GRANT SELECT ON TABLES TO reporting_role;';
    const { references } = await analyzeSql(sql);
    expect(references).toEqual([
      { type: 'role', name: 'owner_role' },
      { type: 'schema', name: 'app' },
      { type: 'role', name: 'reporting_role' },
    ]);
  });

  it('extracts the new owner of ALTER TABLE ... OWNER TO', async () => {
    const { references } = await analyzeSql('ALTER TABLE parent OWNER TO owner_role;');
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'role', name: 'owner_role' },
    ]);
  });

  it('extracts the new owner of ALTER SCHEMA ... OWNER TO', async () => {
    const { references } = await analyzeSql('ALTER SCHEMA app OWNER TO owner_role;');
    expect(references).toEqual([{ type: 'role', name: 'owner_role' }]);
  });

  it('does not reference a role the same file creates', async () => {
    const sql = `
      CREATE ROLE reporting_role NOLOGIN;
      GRANT SELECT ON parent TO reporting_role;
    `;
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'role', name: 'reporting_role' }]);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
  });
});

describe('deps — analyzeSql DO blocks', () => {
  it('reads DDL wrapped in a DO block', async () => {
    const sql = 'DO $$ BEGIN CREATE TABLE child (id uuid REFERENCES parent(id)); END $$;';
    const { creates, references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'child' }]);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('reads a GRANT wrapped in a DO block', async () => {
    const sql = 'DO $$ BEGIN GRANT SELECT ON parent TO reporting_role; END $$;';
    const { references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'role', name: 'reporting_role' },
    ]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('reads statements nested in IF and LOOP bodies', async () => {
    const sql = `DO $$
      DECLARE r record;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx') THEN
          CREATE INDEX idx ON parent (created_at);
        END IF;
        FOR r IN SELECT id FROM parent LOOP
          GRANT SELECT ON child TO reporting_role;
        END LOOP;
      END $$;`;
    const { references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'table', name: 'child' },
      { type: 'role', name: 'reporting_role' },
    ]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('reads every DO block in a file', async () => {
    const sql = `
      DO $$ BEGIN GRANT SELECT ON parent TO reporting_role; END $$;
      CREATE TABLE child (id INT);
      DO $$ BEGIN CREATE INDEX idx ON other (id); END $$;
    `;
    const { creates, references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'child' }]);
    expect(references).toEqual([
      { type: 'table', name: 'parent' },
      { type: 'role', name: 'reporting_role' },
      { type: 'table', name: 'other' },
    ]);
    expect(unanalyzedBlocks).toBe(0);
  });

  it('drops references a DO block creates in the same file', async () => {
    const sql = `
      CREATE TABLE child (id INT);
      DO $$ BEGIN CREATE INDEX idx ON child (id); END $$;
    `;
    const { creates, references } = await analyzeSql(sql);
    expect(creates).toEqual([{ type: 'table', name: 'child' }]);
    expect(references).toEqual([]);
  });

  it('counts dynamic EXECUTE as unanalyzed', async () => {
    const sql = "DO $$ BEGIN EXECUTE format('CREATE TABLE %I (id int)', 'dyn'); END $$;";
    const { creates, references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(creates).toEqual([]);
    expect(references).toEqual([]);
    expect(unanalyzedBlocks).toBe(1);
  });

  it('counts each dynamic EXECUTE separately', async () => {
    const sql = `DO $$ BEGIN
      EXECUTE 'CREATE TABLE a (id int)';
      EXECUTE 'CREATE TABLE b (id int)';
      CREATE INDEX idx ON parent (id);
    END $$;`;
    const { references, unanalyzedBlocks } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
    expect(unanalyzedBlocks).toBe(2);
  });

  it('reports a DO body the parser rejects instead of calling it unanalyzable', async () => {
    const { references, unanalyzedBlocks, parseFailures } = await analyzeSql('DO $$ THIS IS NOT PLPGSQL $$;');
    expect(references).toEqual([]);
    expect(unanalyzedBlocks).toBe(0);
    expect(parseFailures).toHaveLength(1);
    expect(parseFailures[0]).toMatch(/^DO block: /);
  });
});

// The parser reports offsets in bytes; a JavaScript string is indexed in UTF-16
// code units. Anything multi-byte earlier in the file pushes the two apart.
describe('deps — analyzeSql with multi-byte characters', () => {
  const doBlock = 'DO $$\nBEGIN\n  GRANT SELECT ON parent TO reporting_role;\nEND\n$$;';
  const expected = [
    { type: 'table', name: 'parent' },
    { type: 'role', name: 'reporting_role' },
  ];

  it('reads a DO block preceded by a multi-byte comment', async () => {
    const { references, unanalyzedBlocks, parseFailures } = await analyzeSql(`-- コメント\n${doBlock}`);
    expect(references).toEqual(expected);
    expect(unanalyzedBlocks).toBe(0);
    expect(parseFailures).toEqual([]);
  });

  it('reads a DO block preceded by a multi-byte statement', async () => {
    const sql = `CREATE TABLE t (id INT);\nCOMMENT ON TABLE t IS '日本語の説明';\n${doBlock}`;
    const { references, parseFailures } = await analyzeSql(sql);
    expect(references).toEqual(expected);
    expect(parseFailures).toEqual([]);
  });

  it('reads the second of two DO blocks separated by multi-byte text', async () => {
    const sql = `${doBlock}\n-- 途中のコメント\nDO $$ BEGIN CREATE INDEX idx ON other (id); END $$;`;
    const { references, parseFailures } = await analyzeSql(sql);
    expect(references).toEqual([...expected, { type: 'table', name: 'other' }]);
    expect(parseFailures).toEqual([]);
  });

  it('reads a trailing DO block with no closing semicolon', async () => {
    const sql = '-- コメント\nDO $$ BEGIN CREATE INDEX idx ON parent (id); END $$';
    const { references, parseFailures } = await analyzeSql(sql);
    expect(references).toEqual([{ type: 'table', name: 'parent' }]);
    expect(parseFailures).toEqual([]);
  });

  it('reads a DO block holding multi-byte text of its own', async () => {
    const sql = `-- コメント\nDO $$\nBEGIN\n  -- 内側のコメント\n  COMMENT ON TABLE parent IS '親テーブル';\nEND\n$$;`;
    const { references, parseFailures } = await analyzeSql(sql);
    expect(parseFailures).toEqual([]);
    expect(references).toEqual([]);
  });
});

describe('deps — parseExplicitDepsFromSql', () => {
  it('extracts depends-on comments', () => {
    const sql = `-- migraguard:depends-on 20260301_100000__create_users.sql
CREATE TABLE posts (id INT);`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: '20260301_100000__create_users.sql' },
    ]);
  });

  it('extracts multiple depends-on', () => {
    const sql = `-- migraguard:depends-on a.sql
-- migraguard:depends-on b.sql
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: 'a.sql' },
      { target: 'b.sql' },
    ]);
  });

  it('returns empty when no depends-on', () => {
    expect(parseExplicitDepsFromSql('CREATE TABLE t (id INT);')).toEqual([]);
  });

  it('ignores non-matching comments', () => {
    const sql = `-- this is a comment
-- migraguard:other-directive
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([]);
  });

  it('parses phase-level dependency', () => {
    const sql = `-- migraguard:depends-on 20260315_100000__rename_user_status:expand
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: '20260315_100000__rename_user_status', phase: 'expand' },
    ]);
  });

  it('parses backfill phase dependency', () => {
    const sql = `-- migraguard:depends-on 20260315_100000__rename_user_status:backfill
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: '20260315_100000__rename_user_status', phase: 'backfill' },
    ]);
  });

  it('parses contract phase dependency', () => {
    const sql = `-- migraguard:depends-on 20260315_100000__rename_user_status:contract
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: '20260315_100000__rename_user_status', phase: 'contract' },
    ]);
  });

  it('does not parse invalid phase as phase dependency', () => {
    const sql = `-- migraguard:depends-on some_file:invalid_phase
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual([
      { target: 'some_file:invalid_phase' },
    ]);
  });
});

describe('deps — cycle detection', () => {
  it('detects no cycles in a DAG', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b', 'c'],
      edges: [
        { from: 'b', to: 'a', via: 'tbl' },
        { from: 'c', to: 'a', via: 'tbl' },
      ],
      fileDeps: new Map(),
    };
    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects a simple cycle', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b', via: 'tbl' },
        { from: 'b', to: 'a', via: 'tbl' },
      ],
      fileDeps: new Map(),
    };
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('deps — topologicalSort', () => {
  it('sorts dependencies before dependents', () => {
    const graph: DependencyGraph = {
      files: ['c', 'a', 'b'],
      edges: [
        { from: 'b', to: 'a', via: 'tbl' },
        { from: 'c', to: 'b', via: 'tbl' },
      ],
      fileDeps: new Map(),
    };
    const sorted = topologicalSort(graph);
    expect(sorted).not.toBeNull();
    expect(sorted!.indexOf('a')).toBeLessThan(sorted!.indexOf('b'));
    expect(sorted!.indexOf('b')).toBeLessThan(sorted!.indexOf('c'));
  });

  it('returns null for cyclic graph', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b'],
      edges: [
        { from: 'a', to: 'b', via: 'x' },
        { from: 'b', to: 'a', via: 'y' },
      ],
      fileDeps: new Map(),
    };
    expect(topologicalSort(graph)).toBeNull();
  });
});

describe('deps — findLeafNodes', () => {
  it('identifies leaf nodes', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b', 'c', 'd'],
      edges: [
        { from: 'b', to: 'a', via: 'tbl' },
        { from: 'c', to: 'a', via: 'tbl' },
        { from: 'd', to: 'b', via: 'tbl' },
      ],
      fileDeps: new Map(),
    };
    const leaves = findLeafNodes(graph).sort();
    expect(leaves).toEqual(['c', 'd']);
  });

  it('all files are leaves when no edges', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b'],
      edges: [],
      fileDeps: new Map(),
    };
    expect(findLeafNodes(graph).sort()).toEqual(['a', 'b']);
  });
});

describe('deps — findTransitiveDependents', () => {
  it('finds all transitive dependents', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b', 'c', 'd', 'e'],
      edges: [
        { from: 'b', to: 'a', via: 'x' },
        { from: 'c', to: 'b', via: 'x' },
        { from: 'd', to: 'a', via: 'x' },
        { from: 'e', to: 'd', via: 'x' },
      ],
      fileDeps: new Map(),
    };
    const deps = findTransitiveDependents(graph, 'a');
    expect([...deps].sort()).toEqual(['b', 'c', 'd', 'e']);
  });

  it('returns empty when no dependents', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b'],
      edges: [{ from: 'b', to: 'a', via: 'x' }],
      fileDeps: new Map(),
    };
    expect(findTransitiveDependents(graph, 'b').size).toBe(0);
  });

  it('handles partial blocking correctly', () => {
    const graph: DependencyGraph = {
      files: ['a', 'b', 'c', 'd', 'e'],
      edges: [
        { from: 'b', to: 'a', via: 'x' },
        { from: 'c', to: 'b', via: 'x' },
        { from: 'd', to: 'a', via: 'x' },
        { from: 'e', to: 'd', via: 'x' },
      ],
      fileDeps: new Map(),
    };
    const depsOfB = findTransitiveDependents(graph, 'b');
    expect([...depsOfB].sort()).toEqual(['c']);
  });
});
