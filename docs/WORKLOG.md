# 作業ログ（WORKLOG）

エージェントと人が、進み具合と決めたことを残す場所。新しいファイルを足すときは [README.md](./README.md) の索引にも足す。

## 2026-10-31 — #268 エージェント用トークンと操作ログ

### 状況確認

- `origin/main` SHA: `3502c6a79ea178cef9a5271410466bd3c3f5967a`（`/privacy` `/terms` 正式版）
- 開いている関連 Issue: #267（親）, #268（本作業）, #269 REST/MCP, #270 価格・画像・URL 安全化（並行・非接触）, #271 拡張のトークン移行
- 開いている PR: #257（UI 案・本作業と無関係）
- 作業前 `npm test`: 610 pass

### 決めたこと（Issue どおり）

- 平文は作成時のみ。DB は `token_hash`（SHA-256）と識別用 `token_prefix`（`byoagt_` + 先頭）
- 権限は `read` / `write`（配列で保持。どちらも必須ではないが、作成時は1つ以上）
- 有効期限 既定 90 日・最長 365 日。失効は `revoked_at`
- パスワード変更で全エージェント用トークン失効。ログアウト（`session_generation`）では失効しない
- `getCurrentUser` / `getUserIdFromToken` / 画面向け `withAccess` はエージェント用トークンを受け付けない
- 共有ヘルパー `requireAgentToken(scope)` と最小確認用 `GET /api/agent/v1/me` を用意。本 API / MCP は #269
- レート制限: read 60/分, add 20/分, add_url 10/分, add_day 200/日（`consumeAgentRate`。#269 が呼び出し）
- 品目に `added_by_agent_token_id`。設定画面からトークン単位でゴミ箱へ一括移動
- 操作ログ `agent_audit_log` は 90 日（書き込み時に刈り取り）。トークン値は記録しない
- 退会時に `agent_tokens` / `agent_audit_log` / 当該レート制限バケットを削除
- ゲストはトークン作成不可。既存の拡張 JWT とログインは変更しない（#271）
- マイグレーションは追加のみ（`CREATE TABLE IF NOT EXISTS` + `addColumnIfNotExists`）。本番 DB には触っていない

### 結果

- 実装ブランチ: `cursor/agent-access-tokens-a1fa`
- PR: https://github.com/maishu-kobo/butuyokuoh/pull/274（draft → CI 緑で ready）
- head SHA: `21267908f384acf5f289eb2bdbaa1e7c490de822`
- 追加テスト: `tests/agent-tokens.test.ts`（12件）
- ローカル確認: `npm test` 622 pass、`tsc` / `lint` / `build` 成功

### 残っていること

- #269: REST API とリモート MCP（本ヘルパーを利用）
- #270: 価格・画像ホスト・URL パラメータ・品名トリム（並行。本 PR では非接触）
- #271: Chrome 拡張を新トークンへ。設定のログイン用 JWT 表示の廃止
- スキーマ変更のため、マージ前に人間の承認が必要（AGENTS.md）
- プライバシーポリシー / 利用規約へのエージェント連携追記は親 #267 の別作業
