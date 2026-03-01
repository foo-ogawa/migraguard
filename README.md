# migraguard

PostgreSQL 向けの SQL マイグレーション管理ツールチェイン。

DDL を直 SQL で記述し、`psql` で実行するシンプルな構成を前提に、冪等性の担保・改ざん検知・スキーマ drift チェックを提供する。

## Guarantees

migraguard は以下を保証する。

- **editable ノード以外の変更を CI で検出して落とす** — 線形モデルでは末尾ファイル、DAG モデルでは葉ノードのみが編集可能。それ以外のファイルが変更されていれば `check` がエラーを返す
- **意図しない巻き戻し（regression）を検出してエラー** — hotfix 済みのファイルが古いチェックサムに戻っている場合、`apply` が即座にエラーを返す
- **`apply` は advisory lock で排他制御** — 同一環境への同時適用を防止し、競合状態を排除する
- **`apply --verify` は事前 drift 検知 → 適用 → dump 更新を一貫実行** — スキーマの期待状態と実 DB の乖離を検出してから適用し、適用後に dump を自動更新する
- **失敗状態は DB に記録され、未解決のまま先に進めない** — `failed` 状態のファイルが残っている限り後続の適用はブロックされる。`resolve` による明示的な人間の判断を要求する

## Quick Start

```bash
# インストール
npm install --save-dev migraguard

# 新規マイグレーション作成 → SQL 編集 → ローカル DB に適用
npx migraguard new create_users_table
vim db/migrations/20260301_120000__create_users_table.sql
npx migraguard apply

# リリース前: squash → lint + check → dump 更新
npx migraguard squash
npx migraguard lint && npx migraguard check
npx migraguard dump

# PR では CI が lint + check（+ 任意で verify）を実行
# リリース前に squash で 1 ファイルにまとめてからマージ
```

## 設計思想

- **直 SQL**: マイグレーションは `psql -f` で実行可能な SQL ファイルとして管理する。ORM やマイグレーションフレームワーク固有の DSL を排除し、トランザクション境界を SQL に明示する
- **forward-only**: 適用済みマイグレーションの変更を原則禁止し、常に前方向へ積み上げる。最新のマイグレーションファイルのみ、冪等性が担保されている前提で上書き更新・再適用を許容する
- **リリース単位は 1 ファイル**: 依存関係のあるマイグレーションファイルはリリース前に `squash` で 1 ファイルにまとめる。1 ファイル = 1 リリース単位とすることで、エラー時の修正・再適用を単純化する。DAG モデルでは独立した DDL は個別にリリース可能で、`squash` は依存チェーンごとに自動グループ化して実行する
- **依存ツリーによる並行リリース**: DDL の依存関係を解析して DAG を構築し、独立した変更の並行作業・並行リリースを可能にする。線形モデルの制約を緩和し、大規模システムでの運用を改善する
- **検証を左に寄せる**: Squawk による lint、チェックサムによる改ざん検知、スキーマ dump の diff を CI（PR 段階）で実行し、本番到達前にリスクを排除する
- **最小構成**: `psql` + SQL ファイル + メタデータ JSON + DB 状態テーブルによる管理。ツール固有のロックイン・ブラックボックスを避ける

## 二層の状態管理

migraguard はファイル整合性と適用状態を分離して管理する。

| レイヤ | 保存場所 | 役割 |
|--------|----------|------|
| **metadata.json**（リポジトリ） | `db/.migraguard/metadata.json` | マイグレーションファイルの一覧とチェックサム。CI での整合性チェックに使用。環境に依存しない |
| **schema_migrations テーブル**（各 DB） | 各環境の PostgreSQL | その環境に適用済みのファイルとチェックサムを記録。`apply` 時に未適用分を判定する |

metadata.json は「どのファイルが存在すべきか」を、schema_migrations は「どの環境に何が適用済みか」を表す。この分離により、同一のリポジトリから複数環境（検証・商用）への段階的リリースが正しく動作する。

## 機能一覧

### マイグレーション管理

| 機能 | 説明 |
|------|------|
| `migraguard new <name>` | ローカルタイムゾーンのタイムスタンプ（またはシリアル番号）付きの新規マイグレーション SQL ファイルを生成 |
| `migraguard squash` | 未適用の複数マイグレーションファイルを 1 ファイルにマージ。リリース前に実行する |
| `migraguard apply` | 未適用マイグレーションを順番に `psql` で実行。対象 DB の `schema_migrations` テーブルで適用済みを判定 |
| `migraguard resolve <file>` | 失敗したマイグレーションを明示的にスキップ済みとしてマーク。後続の forward migration で修正済みであることを人間が判断した上で実行する |
| `migraguard status` | 適用済み・未適用・失敗・スキップのマイグレーション一覧を表示 |
| `migraguard editable` | 現在編集可能なマイグレーションファイルを一覧表示。線形モデルでは末尾ファイル、DAG モデルでは葉ノードが対象。DB 接続時は `schema_migrations` も参照し、failed 状態のリトライ可能ファイルも表示する |

### 整合性チェック

| 機能 | 説明 |
|------|------|
| `migraguard check` | metadata.json とファイル本体のチェックサム比較。最新ファイル以外の変更・追加を検出しエラーとする。DB 接続不要 |
| `migraguard lint` | Squawk を使用した SQL lint。冪等性・安全性に関するルール違反を検出 |
| `migraguard verify` | shadow DB を使用して各マイグレーションの冪等性を動的に検証する。既存 DB をダンプして復元し、未適用分を2回適用してエラーなし・スキーマ不変を確認する |
| `migraguard verify --all` | 空の shadow DB で全マイグレーションを最初から冪等性検証する |

### スキーマ管理

| 機能 | 説明 |
|------|------|
| `migraguard dump` | `pg_dump --schema-only` を実行し、正規化したスキーマを出力。diff が取れる形式で保存 |
| `migraguard diff` | 現在の DB スキーマと保存済みスキーマ dump の差分を表示 |

### 依存関係解析・DAG モデル

| 機能 | 説明 |
|------|------|
| `migraguard deps` | マイグレーション間の依存関係をツリー形式で表示。◆=editable（葉ノード）、◇=locked（非葉ノード）のマーク付き |
| `migraguard deps --html <path>` | GitGraph.js による依存グラフの HTML を生成 |

![Migration Dependency Graph](assets/deps-graph.png)

## ディレクトリ構成

```
project-root/
├── migraguard.config.json          # 設定ファイル
├── db/
│   ├── migrations/            # マイグレーション SQL ファイル（デフォルト）
│   │   ├── 20260301_120000__create_users_table.sql
│   │   ├── 20260302_093000__add_email_index.sql
│   │   └── ...
│   ├── schema.sql             # 正規化されたスキーマ dump（生成物）
│   └── .migraguard/
│       └── metadata.json      # ファイル一覧 + チェックサム（適用状態は含まない）
├── services/                  # モノレポ構成の場合
│   ├── auth/migrations/       # migrationsDirs で追加の検索パスを指定可能
│   │   └── ...
│   └── billing/migrations/
│       └── ...
└── ...
```

`migrationsDirs` で複数の検索パスを指定すると、全ディレクトリからマイグレーションファイルをスキャンし、タイムスタンプ（またはシリアル番号）順にソートして一元管理する。`new` / `squash` は配列の先頭ディレクトリに書き込む。

### schema_migrations テーブル（各環境の DB に作成）

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    id          BIGSERIAL    PRIMARY KEY,
    file_name   VARCHAR(256) NOT NULL,
    checksum    VARCHAR(64)  NOT NULL,
    status      VARCHAR(16)  NOT NULL DEFAULT 'applied',  -- applied / failed / skipped
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ                               -- skipped 時の解決日時
);
```

`migraguard apply` の初回実行時に自動作成される。

**履歴方針: 完全 INSERT-only**

PK は `BIGSERIAL`（自動採番）であり、同一ファイル・同一チェックサムであっても毎回新しいレコードが INSERT される。UPDATE は行わない。

- 同一ファイルの再適用（hotfix でチェックサム変更後の再適用など）→ 新しいチェックサムで別レコードを INSERT
- 同一チェックサムでの再実行（冪等性による再適用）→ 同じチェックサムで別レコードを INSERT（`applied_at` が異なる）
- `failed` → 修正後の再実行 → `failed` レコードは残したまま、新しい `applied` レコードを INSERT
- `resolve` → `failed` レコードは残したまま、同じチェックサムで `skipped` レコードを INSERT

あるファイルの「最新状態」は、そのファイル名の最新レコード（`applied_at` が最大）の `status` で判定する。過去のレコードは監査ログとして残り続ける。

status の意味:

| status | 意味 |
|--------|------|
| `applied` | 正常に適用済み |
| `failed` | 適用を試みたがエラーで失敗。未解決 |
| `skipped` | `migraguard resolve` により明示的にスキップ。後続の forward migration で修正済みという人間の判断 |

### Hotfix 済みマイグレーションの意図しない巻き戻し検知（regression detection）

**防いでいる事故**: hotfix で修正済みのマイグレーションファイルが、git revert・ブランチ切り替え・マージミスなどにより古いバージョンに戻ってしまい、修正前の DDL が本番に再適用されること。

apply 時、ファイルの現在のチェックサムが **過去のレコード（最新以外）のチェックサムと一致** した場合、意図しない巻き戻しとしてエラーにする。

```
例:
  schema_migrations に以下の履歴がある場合:
    (S1.sql, checksum_v1, applied)   ← 初回適用
    (S1.sql, checksum_v2, applied)   ← hotfix で再適用

  ファイルのチェックサムが checksum_v1 に戻っている
    → 最新レコードは checksum_v2 → 不一致 → さらに過去の checksum_v1 と一致
    → 巻き戻しとしてエラー
```

## 設定ファイル（migraguard.config.json）

```json
{
  "migrationsDirs": ["db/migrations"],
  "schemaFile": "db/schema.sql",
  "metadataFile": "db/.migraguard/metadata.json",
  "naming": {
    "pattern": "{timestamp}__{description}.sql",
    "timestamp": "YYYYMMDD_HHMMSS",
    "prefix": "",
    "sortKey": "timestamp"
  },
  "connection": {
    "host": "localhost",
    "port": 5432,
    "database": "myapp_dev",
    "user": "postgres"
  },
  "dump": {
    "normalize": true,
    "excludeOwners": true,
    "excludePrivileges": true
  },
  "lint": {
    "squawk": true
  }
}
```

### naming 設定

| キー | デフォルト | 説明 |
|------|-----------|------|
| `pattern` | `{timestamp}__{description}.sql` | ファイル名のテンプレート。`{timestamp}`, `{prefix}`, `{description}` を使用可能 |
| `timestamp` | `YYYYMMDD_HHMMSS` | タイムスタンプのフォーマット（ローカルタイムゾーン）。`NNNN` 等の `N` のみの形式でシリアル番号モード（既存ファイルの最大番号 + 1 で自動採番） |
| `prefix` | `""` | 全ファイルに付与する固定プレフィックス。カテゴリやサービス名の識別に使用 |
| `sortKey` | `timestamp` | ファイルのソート順を決定するキー。`timestamp`（タイムスタンプ部分で昇順）が標準 |

**カスタマイズ例**:

```json
// マイクロサービス別にプレフィックスを付ける
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "prefix": "auth"
  }
}
// → auth_20260301_120000__add_users_table.sql

// 連番ベースにする
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "timestamp": "NNNN",
    "prefix": "billing"
  }
}
// → billing_0001__create_invoices_table.sql

// カテゴリ + タイムスタンプ
{
  "naming": {
    "pattern": "{prefix}_{timestamp}__{description}.sql",
    "prefix": "order-service"
  }
}
// → order-service_20260301_120000__add_shipping_status.sql
```

`migraguard new` はこの設定に従ってファイル名を生成する。`migraguard check` / `apply` はパターンに基づいてタイムスタンプ部分を抽出し、ソート順を決定する。

`migrationsDirs` には複数の検索パスを指定可能。モノレポでマイクロサービスごとにマイグレーションディレクトリを分けている場合に使用する。後方互換のため `migrationsDir`（単数）も受け付ける。`new` / `squash` は配列の先頭ディレクトリに書き込む。

```json
// モノレポでの複数ディレクトリ構成例
{
  "migrationsDirs": [
    "db/migrations",
    "services/auth/migrations",
    "services/billing/migrations"
  ]
}
```

`connection` は環境変数（`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`）でオーバーライド可能。

## マイグレーションファイルの規約

### ファイル命名

デフォルトのパターン:

```
YYYYMMDD_HHMMSS__<description>.sql
```

`naming` 設定でカスタマイズした場合:

```
<prefix>_YYYYMMDD_HHMMSS__<description>.sql
```

- タイムスタンプはローカルタイムゾーン（`naming.timestamp` で形式を変更可能。`NNNN` でシリアル番号モード）
- description は英数字とアンダースコアのみ
- 操作種別を先頭に付与: `create_`, `add_`, `alter_`, `drop_`, `backfill_`, `create_index_`
- prefix はカテゴリ・マイクロサービス名等の識別子（`naming.prefix` で設定）

### 冪等性の担保

マイグレーション SQL は冪等に書く。途中失敗後の再実行で安全に完了すること。

```sql
-- IF NOT EXISTS / IF EXISTS を活用
CREATE TABLE IF NOT EXISTS users (...);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users (email);

-- backfill は WHERE 句で冪等条件を付ける
UPDATE users SET status = 'active' WHERE status IS NULL;
```

## squash のフロー

`migraguard squash` は、開発中に作成した複数のマイグレーションファイルを 1 ファイルにまとめる。リリースブランチへのマージ前に実行する。

```bash
npx migraguard squash
```

### 線形モデルでの動作

1. metadata.json を読み込む
2. `migrationsDir` のファイルのうち、metadata.json に記録されていない新規ファイルを特定
3. 新規ファイルが 2 つ以上ある場合、タイムスタンプ順に連結して 1 ファイルにまとめる
4. マージ後のファイル名は最新のタイムスタンプを採用し、description は結合する
5. 元のファイルを削除し、metadata.json を更新

```
squash 前:
  20260228_120000__add_user_email.sql     (新規)
  20260301_093000__add_email_index.sql    (新規)

squash 後:
  20260301_093000__add_user_email_and_email_index.sql  (1ファイルに統合)
```

`migraguard check` は新規ファイル（metadata.json に未記録）が 2 つ以上ある場合にエラーとする。squash を実行してから push する運用を強制する。

### DAG モデルでの動作

DAG モードでは、新規ファイルを依存関係に基づいて連結成分（グループ）に自動分割し、グループごとに squash する。独立した DDL（互いに依存関係がない）は個別のファイルとして残す。

```
squash 前:
  20260308_100000__create_follows.sql         (新規 — users に依存)
  20260308_110000__add_follow_index.sql       (新規 — follows に依存)
  20260309_100000__create_notifications.sql   (新規 — users に依存、follows とは独立)

squash 後:
  20260308_110000__create_follows_and_add_follow_index.sql  (依存チェーンを統合)
  20260309_100000__create_notifications.sql                 (独立 — そのまま)
```

各グループ内ではタイムスタンプの古い順に連結し、依存先が先・依存元が後の順序を保証する。

### なぜ依存チェーンを 1 ファイルにまとめるか

複数ファイルが未適用の状態でリリースすると、以下の問題が起きる。

**エラー時に修正できない**:
- `20260228_` と `20260301_` が未適用の状態で検証環境に反映
- `20260228_` でエラー発生
- 修正したいが、最新ファイルは `20260301_` なので `20260228_` の変更は check でブロックされる
- `20260301_` は `20260228_` に依存しているため、両方の修正が必要になる

**1 ファイルなら単純**:
- squash 後の 1 ファイルがエラー → そのファイルを修正 → 再適用
- 葉ノードルールに適合し、冪等性により安全に再実行できる

独立した DDL はこの問題が発生しないため、無理にまとめる必要はない。

## apply のフロー

`migraguard apply` は対象 DB の `schema_migrations` テーブルを参照して未適用分を判定・実行する。

1. DB の `schema_migrations` テーブルから全レコードを取得
2. `migrationsDir` のファイルをタイムスタンプ順にソート
3. 各ファイルについて、**そのファイル名の最新レコード**（`applied_at` が最大のもの）を参照して判定:
   - 最新レコードなし → 新規ファイル → `psql -v ON_ERROR_STOP=1 -f <file>` で実行
   - 最新レコード status=`applied` + チェックサム一致 → スキップ
   - 最新レコード status=`applied` + チェックサム不一致:
     - 過去レコードのチェックサムと一致 → 即エラー（先祖返り検知）
     - 最新ファイル（末尾） → 再適用（冪等性前提）
     - 最新以外 → 即エラー（改ざん検知）
   - 最新レコード status=`skipped` → スキップ（`resolve` 済み）
   - 最新レコード status=`failed`:
     - 最新ファイル（末尾） → リトライ（修正済みの想定）
     - 最新以外 → 即エラー（未解決の失敗。`migraguard resolve` または squash が必要）
4. 実行結果に応じて `schema_migrations` へ **新規レコードを INSERT**:
   - 成功 → status=`applied`
   - 失敗 → status=`failed`、以降のファイルは実行しない
5. 最新ファイル（末尾）は更新があっても再適用を許容する（開発中の繰り返し反映、および本番エラー時の hotfix 対応を想定）

metadata.json はこのフローでは参照しない。apply は DB の状態のみを信頼する。

### 履歴の蓄積例

```
schema_migrations テーブルの状態推移:

── 初回適用 ──
(S1.sql, checksum_v1, applied, 2026-03-01 12:00)

── S1 を修正して再適用（hotfix） ──
(S1.sql, checksum_v1, applied, 2026-03-01 12:00)   ← 過去レコード（残る）
(S1.sql, checksum_v2, applied, 2026-03-01 15:00)   ← 最新レコード

── 誤って checksum_v1 に戻してしまった場合 ──
→ 過去レコード checksum_v1 と一致 → 先祖返りエラー
```

### 失敗時のリカバリ

```
ケース 1: 最新ファイル S1 が失敗（S1 の後にファイルがない）
  → S1 を修正して再度 apply（S1 は最新なので修正可能、failed → リトライ）
  → 新しいチェックサムで applied レコードが追加される

ケース 2: S1 が失敗した後に S2 が追加された（S1 は最新ではなくなった）
  → apply は「S1 が未解決」でエラー停止
  → 選択肢 A: migraguard resolve S1 → S1 を skipped にし、S2 で修正内容をカバー
  → 選択肢 B: squash で S1 + S2 を 1 ファイルにまとめ直す
              （DB 上の S1 の failed 記録は孤立するが、apply はファイル基準で動くため無害）
```

### resolve の動作

```bash
npx migraguard resolve 20260301_093000__add_user_email.sql
```

- 対象 DB の `schema_migrations` に、該当ファイルの最新 failed レコードと同じチェックサムで status=`skipped` のレコードを INSERT
- `resolved_at` に現在時刻を記録
- 該当ファイルの最新レコードが `failed` 以外の場合はエラー
- 後続の forward migration で修正済みであることを人間が確認した上で実行する操作

### スキーマ dump による事前検証（apply 時）

`--verify` オプションを付けた場合、apply 前に以下の検証を行う。

1. 現在の DB スキーマを dump し、保存済み `schema.sql` と比較
2. 一致すれば apply を実行
3. apply 完了後、新しいスキーマ dump を生成し `schema.sql` を更新

```bash
migraguard apply --verify
```

## check のフロー（CI 向け）

`migraguard check` は CI 環境で実行することを想定したファイル整合性チェック。DB 接続は不要。

1. metadata.json を読み込む
2. `migrationsDir` の全ファイルのチェックサムを計算
3. 以下をチェック:
   - metadata.json に記録されたファイルのチェックサムが実ファイルと一致するか（最新ファイル以外）
   - 最新ファイル以外に変更がないか
   - 新しいファイルが途中に挿入されていないか（タイムスタンプ順で末尾以外に追加されていないか）
   - **新規ファイル（metadata.json に未記録）が 2 つ以上ないか**
4. 違反があればエラーコード 1 で終了し、差分の詳細を出力

### check の限界と運用規約

check は DB に接続しないため、「どの環境に何が適用済みか」は判定できない。apply は DB 側で `failed` 状態を検知してエラー停止するが、理想的にはこの状況自体を避けるべきである。以下のケースは運用規約で予防する。

**問題が起きるケース**:

```
1. S1 を作成 → dev に反映（S1 適用済み）
2. S1 を pro に反映する前に S2 を追加
3. pro で S1 を apply → エラー発生 → schema_migrations に failed で記録
4. S1 を修正したいが、最新は S2 なので check がブロック
5. apply も「S1 が未解決」でエラー停止
6. リカバリ: migraguard resolve S1 → S2 を apply（S2 で S1 の修正をカバー）
```

リカバリは可能だが、S2 が S1 の意図を正しくカバーしているかは人間が判断する必要がある。この状況を避けるための運用規約を設ける。

**運用規約: 1 リリースの全環境デプロイが完了するまで、次のマイグレーションを追加しない**

```
S1 作成 → dev 反映 → pro 反映 → 全環境完了
                                      │
                              ここで初めて S2 を追加可能
```

この規約に反して S2 を追加した後に S1 の修正が必要になった場合は、S1 を直接修正するのではなく、**新しい forward migration（S3）で修正内容を記述する**。S1 は変更せず、S3 で S1 の問題を補正する。

### check と apply の役割分担

| | check | apply |
|---|---|---|
| 参照先 | metadata.json（リポジトリ） | schema_migrations テーブル（DB） |
| DB 接続 | 不要 | 必要 |
| 用途 | CI での事前検証（PR チェック） | 環境への実適用 |
| 検出対象 | ファイルの改ざん・不正な追加・複数新規ファイル | 未適用ファイルの特定・適用 |

## リリースフロー

リリースブランチが `db_dev`（検証）、`db_pro`（商用）の場合の典型的なフロー。

```
feature ブランチで開発:
  migraguard new add_user_email      → 20260228_120000__add_user_email.sql
  migraguard new add_email_index     → 20260301_093000__add_email_index.sql
  (個別に apply してローカルで動作確認)
         │
         ▼
リリース準備:
  migraguard squash                  → 1 ファイルにマージ
  migraguard lint                    → lint チェック
  migraguard check                   → 整合性チェック
  git commit
         │
         ▼
db_dev にマージ → CI が apply  → 検証環境に反映
         │
         │  エラー時: ファイル修正 → 再 apply（最新 = 唯一のファイルなので修正可能）
         │
         ▼
db_pro にマージ → CI が apply  → 商用環境に反映
         │
         │  エラー時: 同じファイルを修正 → 再 apply
         │  (検証環境は冪等性により修正版を再適用しても安全)
         │
         ▼
       全環境完了 ← ここで初めて次のマイグレーションを追加可能
```

**重要**: 1 リリース（1 ファイル）の全環境デプロイが完了するまで、次のマイグレーションファイルを追加しない。この規約により、最新ファイルの修正・再適用が常に可能な状態を維持する。

### 各環境の状態推移

```
           metadata.json     db_dev schema_migrations   db_pro schema_migrations
           (リポジトリ)       (検証 DB)                  (商用 DB)

squash後    [A, B, S]         [A, B]                     [A, B]
dev反映後   [A, B, S]         [A, B, S ✓]                [A, B]
pro反映後   [A, B, S]         [A, B, S ✓]                [A, B, S ✓]
                                                           ↑ 次のリリース解禁

A, B = 過去の適用済みファイル
S = squash で生成されたファイル
```

metadata.json はファイル一覧のみを持ち、どの環境に適用済みかは各 DB が管理する。同一の metadata.json で複数環境への段階的リリースが正しく動作する。

### 規約に反した場合のリカバリ

全環境デプロイ前に次のファイルを追加してしまい、過去ファイルの修正が必要になった場合:

1. 過去ファイルを直接修正しない（check がブロックする）
2. 新しい forward migration を作成し、過去ファイルの問題を補正する SQL を記述する
3. squash で現在の新規ファイルと forward migration を 1 つにまとめる

## GitHub Actions との連携

### PR 時のチェック（例）

```yaml
name: DB Migration Check
on:
  pull_request:
    paths:
      - 'db/**'

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install migraguard
        run: npm ci

      - name: Lint migrations
        run: npx migraguard lint

      - name: Check metadata integrity
        run: npx migraguard check

      - name: Verify schema dump
        run: |
          # shadow DB で全マイグレーション適用後の dump と比較
          npx migraguard dump --connection-string "$SHADOW_DB_URL" > /tmp/actual_schema.sql
          diff db/schema.sql /tmp/actual_schema.sql
```

### マイグレーション自動実行（例）

```yaml
name: Apply Migrations
on:
  push:
    branches: [db_dev]
    paths:
      - 'db/migrations/**'

jobs:
  apply:
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install migraguard
        run: npm ci

      - name: Check integrity
        run: npx migraguard check

      - name: Apply with verification
        run: npx migraguard apply --verify
        env:
          PGHOST: ${{ secrets.DB_HOST }}
          PGDATABASE: ${{ secrets.DB_NAME }}
          PGUSER: ${{ secrets.DB_USER }}
          PGPASSWORD: ${{ secrets.DB_PASSWORD }}
```

## ローカル開発フロー

```bash
# 1. 新規マイグレーションファイルを作成
npx migraguard new add_user_email

# 2. 生成された SQL ファイルを編集
vim db/migrations/20260301_120000__add_user_email.sql

# 3. ローカル DB に適用（最新ファイルは何度でも再適用可能）
npx migraguard apply

# 4. 必要に応じて追加ファイルを作成・適用
npx migraguard new add_email_index
vim db/migrations/20260302_093000__add_email_index.sql
npx migraguard apply

# 5. リリース前に squash で 1 ファイルにまとめる
npx migraguard squash

# 6. lint + 整合性チェック
npx migraguard lint
npx migraguard check

# 7. スキーマ dump を更新
npx migraguard dump

# 8. コミット
git add db/
git commit -m "add user email column and index"
```

## 依存ツリーモデル（拡張）

線形順序モデルでは「末尾の 1 ファイルだけが修正・再適用可能」という制約がある。依存ツリーモデルはこの制約を緩和し、独立した変更の並行作業を可能にする。

### 線形モデル vs 依存ツリーモデル

```
線形モデル:
  A → B → C → D
                ↑ D だけが修正可能。C のエラーが D のリリースをブロック

依存ツリーモデル:
          A (users テーブル作成)
         / \
        B   C (B: users にカラム追加, C: orders テーブル作成)
        |     \
        D      E (D: users にインデックス, E: orders にインデックス)

  D と E は互いに独立 → 両方とも修正・再適用可能
  D のエラーが E のリリースをブロックしない
```

### 依存関係の解析方法

各マイグレーション SQL を PostgreSQL パーサ（`libpg_query`）で AST にパースし、オブジェクトの生成・参照関係を抽出して DAG（有向非巡回グラフ）を構築する。

```
SQL 文から抽出する情報:

  CREATE TABLE users (...)
    → 生成: users

  ALTER TABLE users ADD COLUMN email VARCHAR(256)
    → 依存: users  → 生成: users.email

  CREATE INDEX CONCURRENTLY ON users (email)
    → 依存: users, users.email

  CREATE TABLE orders (user_id INT REFERENCES users(id))
    → 依存: users  → 生成: orders
```

抽出可能な DDL と依存の種類:

| DDL | 生成 | 依存 |
|-----|------|------|
| `CREATE TABLE` | テーブル | なし（REFERENCES があれば参照先テーブル） |
| `ALTER TABLE ADD COLUMN` | カラム | テーブル |
| `ALTER TABLE ADD CONSTRAINT` | 制約 | テーブル、カラム、参照先テーブル |
| `CREATE INDEX` | インデックス | テーブル、カラム |
| `CREATE VIEW` | ビュー | 参照先テーブル |
| `CREATE FUNCTION` | 関数 | 参照先テーブル（本体の解析が必要） |
| `DROP *` | なし | 削除対象のオブジェクト |

### check と apply への影響

依存ツリーモデルでは「最新ファイル（末尾）」の概念が「葉ノード（他から依存されていないファイル）」に置き換わる。

**check の変更**:
- 変更可能なファイル: 葉ノードのみ（線形モデルの「末尾」に相当）
- 葉ノード以外のファイルが変更されていたらエラー
- 新規ファイルが既存の葉ノードに依存する場合、その葉ノードはもう葉ではなくなる → ロックされる

**apply の変更**:
- トポロジカルソート順にファイルを適用（依存先が先）
- 独立したファイル同士は順序不問
- 失敗時: 失敗したファイルに依存するファイルのみブロック。独立したファイルは影響を受けない

```
例: D が失敗した場合

          A
         / \
        B   C
        |     \
       [D]     E ← D と独立なので apply 可能

  D の失敗は E のリリースをブロックしない
```

### 明示的依存の宣言

AST からの自動抽出には限界がある（動的 SQL、業務ロジック上の依存など）。自動抽出できない依存は SQL ファイル内のコメントで明示的に宣言する。

```sql
-- migraguard:depends-on 20260228_120000__create_users_table.sql

SET lock_timeout = '5s';
...
```

または `migraguard.config.json` で宣言する。

```json
{
  "dependencies": {
    "20260301_093000__backfill_user_status.sql": [
      "20260228_120000__add_user_status_column.sql"
    ]
  }
}
```

自動抽出と明示的宣言をマージして最終的な DAG を構築する。明示的宣言は自動抽出の結果を上書きせず、追加の依存として合成される。

### 大規模システムでの効果

| 制約 | 線形モデル | 依存ツリーモデル |
|------|-----------|-----------------|
| 同時に修正可能なファイル | 1（末尾のみ） | 葉ノードの数（独立した変更の数） |
| 並行リリース | 不可（全環境完了まで次を追加できない） | 独立したブランチは並行リリース可能 |
| エラーの影響範囲 | 全後続ファイルがブロック | 依存するファイルのみブロック |
| 複数チームの作業 | 直列化（1 チームずつ） | 独立したテーブルなら並行作業可能 |

### 実装状況

依存ツリーモデルは線形モデルの上位互換として段階的に導入された。

| フェーズ | 内容 | 状態 |
|---------|------|------|
| Phase 1 | 線形モデルで基本機能（new / apply / check / squash / lint / dump / verify）を実装 | ✅ 完了 |
| Phase 2 | `@pg-nano/pg-parser` による DDL 依存抽出と `migraguard deps` コマンドを実装 | ✅ 完了 |
| Phase 3 | check / apply / editable / squash を依存ツリー対応に拡張。葉ノード判定、トポロジカルソート適用、部分失敗時の独立ブランチ続行 | ✅ 完了 |

## 既存ツールとの比較

migraguard の特徴は「運用規約そのものをツールに埋め込んで、CI で事故を未然に潰す」点にある。既存ツール（Flyway / Atlas / Sqitch / Graphile Migrate など）との差分を整理する。

### 1. 二層の状態管理で多環境の段階的リリースを設計の中心に置いている

リポジトリ側の整合性（metadata.json）と各 DB 側の適用状態（schema_migrations）を明確に分離し、「同一リポジトリから dev → pro の段階的リリース」を設計として破綻しにくくしている。

[Atlas](https://atlasgo.io/concepts/migration-directory-integrity) も `atlas.sum` でディレクトリ整合性（Merkle hash tree 風）を担保するが、migraguard はさらに「環境ごとの差（applied / failed / skipped）を DB 側に寄せる」ことを明示的に設計している。

### 2. 「最新版だけ編集 OK」をルール + 履歴設計で安全側に倒している

単に「最新版だけ編集可」ではなく、apply 時に以下の判定ロジックまで踏み込んでいる。

- 最新レコードが applied だが checksum 不一致 → 過去 checksum と一致したら「先祖返り」としてエラー
- 最新ノード（線形なら末尾、DAG なら葉ノード）だけは再適用許可
- それ以外は改ざんとして即エラー

Flyway / Liquibase にも checksum 検証はあるが、「先祖返りを明確にエラー扱いする」を標準の運用モデルとして提示している例は多くない。

### 3. DB 接続不要の整合性チェックを CI 前提で強制できる

`migraguard check` は metadata.json と実ファイルのチェックサム突合で、DB 接続なしに以下を検出する。

- 最新以外の変更を検出してエラー
- 途中挿入を検出してエラー
- 新規ファイルが 2 つ以上ならエラー（squash を強制）

Atlas も整合性ファイル（`atlas.sum`）でディレクトリの整合性を強制できるが、migraguard は「squash による 1 リリース = 1 ファイル」を機械的に強制するところまで実装に落としている。

### 4. スキーマ dump diff を apply ゲートに組み込んでいる

`migraguard dump` / `migraguard diff` を機能として持ち、`apply --verify` で以下を一連の手順として定義している。

1. 現在 DB の dump と保存 `schema.sql` が一致するか検証
2. 一致したら apply
3. apply 後に新 dump を生成して `schema.sql` を更新

[Graphile Migrate](https://github.com/graphile/migrate) も「pg_dump を git 管理して差分を見る」ことを推奨しているが、migraguard はそれを verify ゲートとして apply に組み込み、手順抜け（運用のブレ）を減らす設計になっている。

### 5. 失敗の取り扱いが現場運用（止める / 進める）を具体化している

`schema_migrations` に `failed` / `skipped` を持たせ、`resolve` で明示的にスキップする運用を定義している。

- 失敗したファイルが最新でなければ apply は即エラー停止（自動スキップしない）
- `resolve` は人間の判断を介在させる明示的操作
- 後続の forward migration で修正する運用を明文化

既存ツールにも repair / ignore 的な逃げ道はあるが、migraguard は「どういう状況でそれを使うか」まで含めて設計されている。

### 6. 依存 DAG への拡張が設計に組み込まれている

線形モデルから依存 DAG（葉ノード = 編集可）への拡張が具体的に設計されている。

- 依存解析で独立した変更を並行リリース可能にする
- 失敗の影響を依存範囲に閉じる
- トポロジカルソート順に apply

[Sqitch](https://sqitch.org/docs/manual/sqitch/) は依存をマイグレーション間で宣言できるが、Merkle tree パターンで整合性を担保する。migraguard は「SQL ファイル（psql 実行）+ CI ゲート + dump diff」を軸にしたまま DAG へ拡張する方向性。

### まとめ

migraguard は既存ツールが提供する「実行エンジン」や「履歴テーブル」よりも、以下を重視している。

- 運用事故の典型パターン（途中挿入、過去改変、先祖返り、段階的リリース中の詰まり）を CI ゲートと規約で潰す
- スキーマ dump を監査可能な成果物として常に diff 可能にし、drift を検知する
- 末端（線形なら末尾、DAG なら葉ノード）だけを可変にして hotfix を許す代わりに検出ロジックを強くする

これらを最小構成（psql + SQL + JSON + dump）で実現する。

## apply の排他制御

冪等な SQL であっても、同時実行は競合状態を引き起こし得る。apply は排他制御として PostgreSQL の advisory lock を使用する。

```
apply の実行フロー（排他制御込み）:
  1. DB 接続確立
  2. pg_advisory_lock(hashtext('migraguard-apply')) を取得
     → 同時に別プロセスが apply を実行している場合はブロック（待機）
  3. schema_migrations を参照して未適用分を判定
  4. 各ファイルを psql で実行、結果を schema_migrations に記録
  5. 接続クローズ（advisory lock は自動解放）
```

advisory lock はセッション単位で効くため、apply 全体を単一セッションで実行する必要がある。接続が切れた場合はロックが自動解放され、再実行が安全に行える。

CI パイプラインの並列実行（同一環境への同時 apply）や、手動 apply とパイプラインの競合を防止する。

## DAG 移行時の互換方針

線形モデルから依存ツリーモデルへ移行する際、既存環境の schema_migrations との整合性を維持する必要がある。

### 移行手順

1. **既存の schema_migrations はそのまま維持**: 線形モデルで記録されたレコードは、DAG モデルでも「依存関係が暗黙的に全直列」のファイルとして扱う
2. **移行ポイントのマーカー**: DAG モデル導入時に metadata.json に `"model": "dag"` フラグを追加。このフラグ以前のファイルは線形順序、以降のファイルは DAG 解析対象とする
3. **後方互換**: DAG モデル対応の migraguard は線形モデルの metadata.json も読める。逆（DAG → 線形へのダウングレード）は非サポート

```
metadata.json の移行例:

{
  "model": "dag",
  "modelSince": "20260401_000000__first_dag_migration.sql",
  "migrations": [
    {"file": "20260301_...", "checksum": "aaa"},  ← 線形モデル時代（全直列扱い）
    {"file": "20260302_...", "checksum": "bbb"},  ← 線形モデル時代
    {"file": "20260401_...", "checksum": "ccc"}   ← DAG モデル（依存解析対象）
  ]
}
```

### check / apply の動作

- `modelSince` より前のファイル: 従来通りタイムスタンプ順の線形チェック
- `modelSince` 以降のファイル: DAG 解析による葉ノード判定、トポロジカルソート適用
- 両者の境界: `modelSince` のファイルは、それ以前の全ファイルに暗黙的に依存する（線形モデルの最終状態を引き継ぐ）

## 技術スタック

| 項目 | 技術 |
|------|------|
| 言語 | TypeScript（Node.js） |
| DB 接続 | `psql` CLI（DDL ファイルを直接渡す） |
| スキーマ dump | `pg_dump --schema-only` |
| SQL lint | [Squawk](https://squawkhq.com/) |
| SQL パーサ | [@pg-nano/pg-parser](https://www.npmjs.com/package/@pg-nano/pg-parser)（DDL 依存解析用。PostgreSQL 実パーサの TypeScript バインディング） |
| パッケージ管理 | npm |
