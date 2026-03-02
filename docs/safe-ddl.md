# Safe DDL Patterns for PostgreSQL

Since migraguard assumes plain SQL executed via `psql`, understanding safe DDL patterns is essential for production migrations. `migraguard lint` enforces these patterns via built-in rules using libpg-query AST analysis — no external tools required.

## Timeout Discipline

PostgreSQL の DDL はテーブルロックを取得する。`lock_timeout` が未設定だと、ロック待ちが無期限に続き、後続クエリが全てブロックされる。`statement_timeout` が未設定だと、重い VALIDATE や backfill が終わらない。どちらも本番障害の直接原因になる。SET したまま RESET しないと、同一セッション内の後続操作にタイムアウト設定が漏れる。

```sql
SET lock_timeout = '5s';
SET statement_timeout = '30s';

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32);

RESET lock_timeout;
RESET statement_timeout;
```

**Rules**: `require-lock-timeout`, `require-statement-timeout`, `require-reset-timeouts`.

## CREATE INDEX CONCURRENTLY

通常の `CREATE INDEX` は対象テーブル全体に排他ロック (ACCESS EXCLUSIVE) を取得し、インデックス構築中は書き込みも読み取りもブロックされる。本番テーブルでは数分〜数十分の停止を引き起こす。`CONCURRENTLY` を使うとロックを最小化できるが、トランザクション内では実行できない制約がある。

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
```

**Rules**:
- `require-concurrent-index` — CREATE INDEX に CONCURRENTLY がない場合にエラー（同一ファイル内で作成されたテーブルはスキップ）
- `ban-concurrent-index-in-transaction` — BEGIN...COMMIT 内の CONCURRENTLY をエラー

## Idempotent Statements (IF NOT EXISTS / IF EXISTS)

マイグレーションが途中で失敗した場合、成功済みの文は再実行時にエラーになる（テーブルが既に存在する等）。`IF NOT EXISTS` / `IF EXISTS` をつけることで、再実行しても安全な冪等 SQL になる。migraguard の設計思想（失敗→修正→再apply）を支える基本パターン。

```sql
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
DROP TABLE IF EXISTS temp_backup;
```

**Rule**: `require-if-not-exists` — CREATE TABLE/INDEX に IF NOT EXISTS がない、DROP に IF EXISTS がない場合にエラー。

## Adding NOT NULL Columns

既存テーブルに NOT NULL カラムを DEFAULT なしで追加すると、PostgreSQL は全行をスキャンして NULL がないことを確認する。大きなテーブルでは長時間の排他ロックとテーブルリライトが発生する。PostgreSQL 11+ では DEFAULT 付きの NOT NULL カラム追加はメタデータ変更のみで即座に完了する。

```sql
-- Bad: 全行スキャン + 排他ロック
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL;

-- Good: メタデータ変更のみ (PG 11+)
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';
```

**Rule**: `adding-not-nullable-field` — NOT NULL カラムを DEFAULT なしで追加した場合にエラー。

## Adding Constraints

FOREIGN KEY や CHECK 制約を直接追加すると、PostgreSQL は全行をスキャンして制約を検証する。この間テーブルは書き込みブロックされる。`NOT VALID` をつけると検証をスキップして即座に制約を追加でき、`VALIDATE CONSTRAINT` で後から非ブロッキングで検証できる。

```sql
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;
-- 別マイグレーションで:
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `constraint-missing-not-valid` — FOREIGN KEY / CHECK 制約の追加に NOT VALID がない場合にエラー。

## NOT VALID + VALIDATE Separation

NOT VALID で制約を追加した後、同一ファイル内で VALIDATE すると、NOT VALID の意味がなくなる（結局同じマイグレーション内でフルスキャンが走る）。VALIDATE はトラフィックの少ない時間帯に別マイグレーションとして実行することで、影響を制御できる。

```sql
-- File 1: 制約追加（高速、ロックなし）
ALTER TABLE orders ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) NOT VALID;

-- File 2（別マイグレーション）: 検証（タイミングを制御）
ALTER TABLE orders VALIDATE CONSTRAINT fk_user;
```

**Rule**: `ban-validate-constraint-same-file` — NOT VALID と VALIDATE CONSTRAINT が同一ファイルにある場合にエラー。

## UNIQUE Constraints

UNIQUE 制約を `ALTER TABLE ... ADD CONSTRAINT UNIQUE (col)` で直接追加すると、内部的にインデックスが構築され、その間テーブルが排他ロックされる。先に `CREATE UNIQUE INDEX CONCURRENTLY` で非ブロッキングにインデックスを作成し、`USING INDEX` で制約に紐づける方が安全。

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ALTER TABLE users ADD CONSTRAINT u_email UNIQUE USING INDEX idx_users_email;
```

**Rule**: `require-unique-via-concurrent-index` — USING INDEX を使わない直接的な UNIQUE 制約追加をエラー。

## ANALYZE After CREATE INDEX

インデックス作成後、クエリプランナーは最新の統計情報がないと新しいインデックスを最適に活用できない。autovacuum が統計を更新するまでにはラグがあるため、マイグレーション内で明示的に `ANALYZE <table>` を実行するのが確実。テーブル名を指定しない bare `ANALYZE;` はデータベース全体をスキャンするため、本番では危険。

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);
ANALYZE users;
```

**Rules**:
- `require-analyze-after-index` — CREATE INDEX の後に `ANALYZE <table>` がない場合にエラー（DROP INDEX は AST からテーブルを特定できないため対象外）
- `ban-bare-analyze` — テーブル名なしの `ANALYZE;` をエラー

## Views

PostgreSQL の `CREATE VIEW` は既存ビューがあるとエラーになる。`CREATE OR REPLACE VIEW` を使えば冪等に更新できる。ただし、ビュー定義に `SELECT *` を使うと、基テーブルのカラム変更時に `OR REPLACE` が失敗する（列数・列名の互換性が壊れる）。列を明示することでスキーマ変更に強いビューになる。

```sql
-- Good: 冪等 + 列明示
CREATE OR REPLACE VIEW active_users AS
  SELECT id, name, email FROM users WHERE active;
```

**Rules**:
- `require-create-or-replace-view` — CREATE VIEW に OR REPLACE がない場合にエラー
- `ban-select-star-in-view` — VIEW / MATERIALIZED VIEW 定義内の SELECT * をエラー

`DROP VIEW ... CASCADE` は依存オブジェクトを暗黙に削除するため、影響の追跡が困難になる。

**Rule**: `ban-drop-cascade` — CASCADE 付きの DROP をエラー。

## Materialized Views

Materialized View (MV) は実データを保持し、`REFRESH` で更新するオブジェクト。REFRESH は全データの再計算を伴い、ロックと実行時間の影響が大きい。マイグレーションでは作成・インデックス構築・ANALYZE までを行い、REFRESH は別ジョブとして管理すべき。MV はバージョン名で新規作成し、外向きのインターフェースは通常 VIEW（OR REPLACE で切替可能）にするのが安定パターン。

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS user_stats_mv AS
  SELECT user_id, count(*) AS post_count FROM posts GROUP BY user_id
  WITH NO DATA;

CREATE OR REPLACE VIEW user_stats AS SELECT user_id, post_count FROM user_stats_mv;
```

**Rules**:
- `require-if-not-exists-materialized-view` — CREATE MATERIALIZED VIEW に IF NOT EXISTS がない場合にエラー
- `ban-refresh-materialized-view-in-migration` — マイグレーション内の REFRESH MATERIALIZED VIEW をエラー

## Destructive DDL

`DROP COLUMN` は不可逆で、依存するビュー・関数・アプリケーションコードを壊す可能性がある。`ALTER COLUMN TYPE` はテーブル全体のリライトと排他ロックを伴うことがあり、大きなテーブルでは長時間の停止を引き起こす。型変更の安全な代替手順は: 新カラム追加 → バックフィル → 切替 → 旧カラム削除（複数マイグレーションに分割）。

```sql
-- Both flagged by default
ALTER TABLE users DROP COLUMN email;
ALTER TABLE users ALTER COLUMN email TYPE TEXT;
```

**Rules**: `ban-drop-column`, `ban-alter-column-type`. ファイル単位で `-- migraguard:allow ban-drop-column` で許可、またはグローバルに `lint.rules` で設定。

## DML in Migrations

WHERE なしの UPDATE / DELETE は全行に影響し、長時間の行ロックと大量の WAL 書き込みを引き起こす。TRUNCATE は ACCESS EXCLUSIVE ロックを取得し、取り消しができない。マイグレーション内の DML は必ず WHERE 条件で範囲を限定し、大量データの変更はバッチ化すべき。

```sql
-- Bad: 全行影響
UPDATE users SET status = 'active';
DELETE FROM users;

-- Good: 範囲限定
UPDATE users SET status = 'active' WHERE status IS NULL AND id BETWEEN 1 AND 100000;
```

**Rules**: `ban-update-without-where`, `ban-delete-without-where`, `ban-truncate`.

## Batch Large Data Backfills

大量行の UPDATE はロック保持時間と WAL 書き込み量の両方で問題になる。単一の UPDATE で全行を変更するのではなく、主キー範囲で分割するか、アプリケーション層でバッチ処理すべき。このパターンは AST では検出できないため、コードレビューで担保する。

```sql
UPDATE users SET status = 'active'
WHERE status IS NULL
  AND id BETWEEN 1 AND 100000;
```

**Rule**: None. AST 解析では無制限バックフィルを検出できない。コードレビューで担保。

## DROP INDEX

通常の `DROP INDEX` は ACCESS EXCLUSIVE ロックを取得し、テーブルへの全アクセスがブロックされる。`DROP INDEX CONCURRENTLY` を使えば書き込みをブロックせずにインデックスを削除できる。CREATE INDEX と同様、本番テーブルでは CONCURRENTLY が必須。

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_users_email;
```

**Rule**: `require-drop-index-concurrently` — DROP INDEX に CONCURRENTLY がない場合にエラー。

## Custom Lint Rules

プロジェクト固有のルールを `.js` / `.mjs` ファイルとして追加できる。`lint.customRulesDir` に配置ディレクトリを指定する。

```json
{ "lint": { "customRulesDir": "lint-rules" } }
```

Each file must default-export a `LintRule` object. The type is available via `import('migraguard').LintRule`.

### Example: FK Column Naming Convention

```javascript
// lint-rules/require-fk-column-suffix.js
/** @type {import('migraguard').LintRule} */
export default {
  id: 'require-fk-column-suffix',
  description: 'FK columns must end with _id',
  create() {
    return {
      CreateStmt(node, ctx) {
        const tableElts = node.tableElts;
        if (!Array.isArray(tableElts)) return;
        for (const elt of tableElts) {
          if (!elt.ColumnDef) continue;
          const col = elt.ColumnDef;
          const constraints = col.constraints;
          if (!Array.isArray(constraints)) continue;
          const hasFk = constraints.some(
            (c) => c.Constraint && c.Constraint.contype === 'CONSTR_FOREIGN',
          );
          if (hasFk && !col.colname?.endsWith('_id')) {
            ctx.report({
              message: `FK column "${col.colname}" does not end with _id`,
              hint: 'Rename to end with _id',
            });
          }
        }
      },
    };
  },
};
```

### Available Visitors

Any PostgreSQL AST node type can be used as a visitor key. Common examples:

| Visitor | Triggered by |
|---------|-------------|
| `CreateStmt` | CREATE TABLE |
| `IndexStmt` | CREATE INDEX |
| `AlterTableStmt` | ALTER TABLE |
| `DropStmt` | DROP TABLE / INDEX / VIEW / ... |
| `ViewStmt` | CREATE VIEW |
| `CreateTableAsStmt` | CREATE MATERIALIZED VIEW |
| `RefreshMatViewStmt` | REFRESH MATERIALIZED VIEW |
| `SelectStmt` | SELECT |
| `InsertStmt` | INSERT |
| `UpdateStmt` | UPDATE |
| `DeleteStmt` | DELETE |
| `CreateFunctionStmt` | CREATE FUNCTION |
| `TransactionStmt` | BEGIN / COMMIT / ROLLBACK |
| `VariableSetStmt` | SET ... |
| `VacuumStmt` | ANALYZE / VACUUM |
| `TruncateStmt` | TRUNCATE |
| `RenameStmt` | ALTER ... RENAME |

This is not a closed list. Any node type in the [libpg-query AST](https://github.com/pganalyze/libpg-query) can be used as a visitor key.

Each visitor receives `(node, ctx)`. Use `ctx.report({ message, hint })` to flag violations. `ctx` also provides shared state: `createdTables`, `lockTimeoutSet`, `inTransaction`.

Custom rules can be disabled via `lint.rules` by their `id`, just like built-in rules.
