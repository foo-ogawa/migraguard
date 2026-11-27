# Changelog

## 0.16.29

### 公開

- npm への公開を Trusted Publishing（GitHub Actions の OIDC）に切り替えました。機能の変更はありません。

## 0.16.28

### 挙動の変更

- `lint` は、構文を解析できない migration のファイルを、全ての方言（PostgreSQL・MySQL・SQLite）でファイル名とともに失敗とします（exit 1。契約 `cli-contract.yaml` の lint の exit 1 の定めのとおり）。従来は、解析できない文に規則を適用せず、合格（exit 0）としていました。backfill の placeholder（`:batch_start`・`:batch_end` などの `:name` の形）は値として読むため、解析の妨げになりません。node-sql-parser が解析できない MySQL・SQLite の構文を含むファイルも、失敗となります。
- checksum の正規化は、設定の方言の字句規則に従います。PostgreSQL の checksum は変わりません。MySQL・SQLite で次の字句を含むファイルは checksum が変わり、記録済みのファイルは `check` で不一致となります: MySQL の実行される comment（`/*! … */`・`/*M! … */`）、入れ子に見える block comment、MySQL の文字列の backslash の escape、空白の続かない `--`（MySQL）、`#` の comment の中の引用符・comment の記号（MySQL）、backtick・`[…]` の識別子の中の comment の記号。
- `implement`・`propose-expand-contract` は、新しいファイルだけを作成します。出力先に同じ名前のファイル・symlink がある場合は、書き込まずに失敗します。
- LLM のコマンドの agent には、ファイルの読み取りの道具を付与しません（文脈はプロンプトに含まれます）。
- Node の要件を `>=22.13.0` とします（出力の色の付け方を `node:util` の `styleText` で判定するため）。

### 修正

- `baseline` が schema.sql の先頭に履歴のコメントの代わりに `[object Promise]` を書き込む不具合を修正しました。
- `verify` が shadow DB への復元に使うダンプの一時ファイルを、所有者だけが読める mode で作成します。
- `deps` は、ファイル全体を構文解析できない場合も、解析の失敗として表示します。

### 依存

- `chalk` を dependencies から削除しました。
- CLI の bundle に同梱する `agent-contracts-runtime` を 0.36.18（`agent-contracts` 0.35.14）に更新しました。
