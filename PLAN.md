# migraguard 実装計画チェックリスト

## Phase 1-A: 基盤モジュール

- [x] A1: `src/config.ts` — 設定ファイル読み込み・バリデーション・環境変数オーバーライド
  - [x] 実装
  - [x] ユニットテスト (`tests/config.test.ts`) — 14 tests
  - [x] lint チェック通過
- [x] A2: `src/naming.ts` — ファイル名生成・パース・タイムスタンプ抽出・ソートキー
  - [x] 実装
  - [x] ユニットテスト (`tests/naming.test.ts`) — 21 tests
  - [x] lint チェック通過
- [x] A3: `src/checksum.ts` — SHA-256 チェックサム計算
  - [x] 実装
  - [x] ユニットテスト (`tests/checksum.test.ts`) — 7 tests
  - [x] lint チェック通過
- [x] A4: `src/scanner.ts` — マイグレーションファイルスキャン・ソート
  - [x] 実装
  - [x] ユニットテスト (`tests/scanner.test.ts`) — 9 tests
  - [x] lint チェック通過
- [x] A5: `src/metadata.ts` — metadata.json 読み込み・書き込み・バリデーション
  - [x] 実装
  - [x] ユニットテスト (`tests/metadata.test.ts`) — 13 tests
  - [x] lint チェック通過

## Phase 1-B: DB 接続不要コマンド群

- [x] B1: `src/commands/new.ts` — 新規マイグレーション SQL ファイル生成
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/new.test.ts`) — 7 tests
  - [x] lint チェック通過
- [x] B2: `src/commands/check.ts` — metadata.json とファイルの整合性チェック
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/check.test.ts`) — 11 tests
  - [x] lint チェック通過
- [x] B3: `src/commands/squash.ts` — 新規ファイルの squash
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/squash.test.ts`) — 8 tests
  - [x] lint チェック通過
- [x] B4: `src/commands/lint.ts` — Squawk lint 実行
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/lint.test.ts`) — 3 tests
  - [x] lint チェック通過
- [x] B5: `src/commands/editable.ts` — 編集可能ファイル一覧（DB なし版）
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/editable.test.ts`) — 8 tests
  - [x] lint チェック通過

## Phase 1-C: DB 接続基盤 + DB 必要コマンド群

- [x] C1: `src/db.ts` — PostgreSQL 接続・schema_migrations テーブル管理・advisory lock
  - [x] 実装
  - [x] ユニットテスト (`tests/db.test.ts`) — 2 tests
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C2: `src/psql.ts` — psql CLI 実行ラッパー
  - [x] 実装
  - [x] ユニットテスト (`tests/psql.test.ts`) — 2 tests
  - [x] lint チェック通過
- [x] C3: `src/commands/apply.ts` — マイグレーション適用（apply フロー全体）
  - [x] 実装
  - [x] CLI 接続
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C4: `src/commands/status.ts` — マイグレーション状態表示
  - [x] 実装
  - [x] CLI 接続
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C5: `src/commands/resolve.ts` — failed マイグレーションの skipped マーク
  - [x] 実装
  - [x] CLI 接続
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C6: `src/commands/editable.ts` — 編集可能ファイル一覧（DB あり版に拡張）
  - [x] 実装（DB 接続時に failed リトライ可能ファイルも表示）
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C7: `src/dumper.ts` — pg_dump 実行・正規化
  - [x] 実装
  - [x] ユニットテスト (`tests/dumper.test.ts`) — 8 tests
  - [x] lint チェック通過
- [x] C8: `src/commands/dump.ts` — スキーマ dump 保存
  - [x] 実装
  - [x] CLI 接続
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C9: `src/commands/diff.ts` — スキーマ diff 表示
  - [x] 実装
  - [x] CLI 接続
  - [x] 統合テスト（`full-scenario.test.ts` でカバー）
  - [x] lint チェック通過
- [x] C10: `src/commands/apply.ts` — `--verify` オプション対応
  - [x] 実装
  - [x] 統合テスト
  - [x] lint チェック通過

## 統合テスト環境 + E2E シナリオ

- [x] `docker-compose.test.yml` — PostgreSQL 16 テスト環境
- [x] `tests/integration/helpers.ts` — テスト用 DB 操作ヘルパー
- [x] `tests/integration/full-scenario.test.ts` — 25 テスト
  - [x] Sprint 1: ユーザ管理 — new → squash → check → apply → status → editable
  - [x] Sprint 2: SNS フォロー機能 — squash → check → apply → status
  - [x] Sprint 3: チャットルーム — squash → check → apply → テーブル確認
  - [x] Sprint 4: DM + 既読管理 — check → apply → 冪等性確認
  - [x] 冪等性（再適用スキップ）
  - [x] 最新ファイル変更時の再適用
  - [x] 先祖返り検知
  - [x] 改ざん検知
  - [x] failed → resolve → apply 成功
  - [x] dump → diff → drift 検知
  - [x] apply --verify: drift でブロック
  - [x] apply --verify: 成功後に schema.sql 更新
  - [x] editable DB あり: failed-retryable ファイル表示
  - [x] verify --all: 冪等な DDL がパス
  - [x] verify --all: 非冪等な DDL が失敗検出
  - [x] verify (incremental): 既存 DB 復元 → 未適用分の冪等性検証
  - [x] verify (incremental): 非冪等な未適用 DDL が失敗検出

## verify コマンド

- [x] `src/commands/verify.ts` — shadow DB 作成・冪等性検証
  - [x] shadow DB ライフサイクル（CREATE → verify → DROP）
  - [x] `--all` モード: 空 DB から全ファイルを2回適用
  - [x] インクリメンタルモード: 既存 DB ダンプ復元 → schema_migrations 参照 → 未適用分のみ検証
  - [x] CLI 接続
  - [x] 統合テスト（4 ケース）
  - [x] lint チェック通過

## Phase 2: 依存解析（情報表示のみ）

- [x] 2-1: SQL パーサライブラリ選定・導入
  - [x] `@pg-nano/pg-parser`（libpg_query の TypeScript fork、AST walk/select ユーティリティ付き）を採用
- [x] 2-2: `src/deps.ts` — DDL AST 解析・オブジェクト生成/依存抽出
  - [x] 実装（CREATE TABLE / ALTER TABLE / CREATE INDEX / CREATE VIEW / DROP / CREATE FUNCTION 対応）
  - [x] ユニットテスト (`tests/deps.test.ts`) — 16 tests
  - [x] lint チェック通過
- [x] 2-3: 明示的依存宣言パース（コメント `-- migraguard:depends-on` / config `dependencies`）
  - [x] 実装
  - [x] ユニットテスト (`tests/deps.test.ts`) — 4 tests
  - [x] lint チェック通過
- [x] 2-4: DAG 構築（自動抽出 + 明示宣言のマージ）・循環検出
  - [x] 実装（トポロジカルソート・葉ノード判定・推移的依存ファイル検索を含む）
  - [x] ユニットテスト (`tests/deps.test.ts`) — 8 tests
  - [x] lint チェック通過
- [x] 2-5: `src/commands/deps.ts` — ツリー形式出力（◆=editable / ◇=locked マーク付き）
  - [x] 実装
  - [x] CLI 接続
  - [x] ユニットテスト (`tests/commands/deps.test.ts`) — 4 tests
  - [x] lint チェック通過

## Phase 3: DAG モデル対応

- [x] 3-1: metadata.json に `model` / `modelSince` フィールド追加・後方互換読み込み
  - [x] 実装（`isDagMode()` / `isPreModelSince()` ヘルパー）
  - [x] ユニットテスト（既存 `tests/metadata.test.ts` — 13 tests で後方互換確認）
  - [x] lint チェック通過
- [x] 3-2: `check` 拡張 — 葉ノード判定・modelSince 前後の線形/DAG 切り替え
  - [x] 実装（DAG モード: 葉ノードのみ checksum 変更許可、multiple new files / mid-sequence insertion チェック無効化）
  - [x] ユニットテスト (`tests/commands/check.test.ts`) — 11 tests（+3 DAG tests）
  - [x] lint チェック通過
- [x] 3-3: `apply` 拡張 — トポロジカルソート適用・部分ブロック
  - [x] 実装（DAG モード: トポロジカルソート順適用、失敗時は依存ファイルのみブロック・独立ファイル続行）
  - [x] 統合テスト（既存テスト全通過で線形モード後方互換確認）
  - [x] lint チェック通過
- [x] 3-4: `editable` 拡張 — 葉ノード表示
  - [x] 実装（DAG モード: 葉ノードを `reason: 'leaf'` で表示）
  - [x] ユニットテスト (`tests/commands/editable.test.ts`) — 8 tests（+2 DAG tests）
  - [x] lint チェック通過
- [x] 3-5: `squash` 拡張 — DAG を考慮した squash バリデーション
  - [x] 実装（無向連結性チェック: 独立ブランチ間の squash を拒否）
  - [x] ユニットテスト (`tests/commands/squash.test.ts`) — 8 tests（+2 DAG tests）
  - [x] lint チェック通過
- [x] 3-6: 統合テスト — DAG シナリオ（独立ブランチ、部分失敗、先祖返り）— 7 tests
  - [x] 独立ブランチの並行 apply（follows + chat_rooms 同時追加）
  - [x] deps ツリーで依存構造を正しく表示
  - [x] 部分失敗（follows 失敗 → chat_rooms は apply 成功）
  - [x] 部分失敗の伝播（chat_rooms 失敗 → chat_messages ブロック、follows は成功）
  - [x] 葉ノードの変更 → 再適用が成功
  - [x] 非葉ノードの改ざん検知
  - [x] 先祖返り検知は DAG モードでも機能
