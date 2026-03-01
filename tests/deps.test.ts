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
});

describe('deps — parseExplicitDepsFromSql', () => {
  it('extracts depends-on comments', () => {
    const sql = `-- migraguard:depends-on 20260301_100000__create_users.sql
CREATE TABLE posts (id INT);`;
    expect(parseExplicitDepsFromSql(sql)).toEqual(['20260301_100000__create_users.sql']);
  });

  it('extracts multiple depends-on', () => {
    const sql = `-- migraguard:depends-on a.sql
-- migraguard:depends-on b.sql
SELECT 1;`;
    expect(parseExplicitDepsFromSql(sql)).toEqual(['a.sql', 'b.sql']);
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
