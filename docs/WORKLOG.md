# 作業ログ

エージェントは作業の前にこのファイルと `AGENTS.md` を読む。終了時に、日付付きのエントリを下の「Decisions and results」へ足す。

## Goal

物欲王の開発判断と結果を、会話の外に残す。

## Current instructions

正本はリポジトリ直下の `AGENTS.md`。仕様の文書は https://docs.google.com/document/d/1BIKZ_U2Sg0bM1Vh4TUsBoV25iCSdnSyTbYqtzOuJ6IQ/edit

## Owners

- リポジトリ: maishu-kobo/butuyokuoh
- 作業ブランチの起点: `develop`。`main` への昇格は人間が判断する。

## Open work

- ループの backlog は `looper/state.md`。このログはループの状態を置き換えない。
- 開いている PR: #31（Dependabot。base は `main`）。
- Issue #79: URL 商品取得の回帰テストと PR CI。`.github/workflows` はまだ無い。
- `npm run lint` は develop `f11349a` で既存の error 4 件により失敗する。

## Decisions and results

### 2026-10-22 — 共有エージェントルールを追加

- 開始時の `develop`: `f11349adccc6580b01e440391311f42ebcb350f4`（`fix: 楽天URLの商品名の文字化けを修正 (#78)`）。
- 既存の `AGENTS.md`、`CHANGELOG.md`、`docs/WORKLOG.md` は無かった。
- 実行結果: `npm ci` 成功。`npm test` 24 件成功。`npx tsc --noEmit` 成功。`npm run build` 成功。`npm run dev -- --port 3000` と `npm run start -- --port 3001` は起動を確認。`npm run lint` は既存 error 4 / warning 22 で exit 1。`npm run test:e2e -- --list` は 13 件。ブラウザでの e2e は未実行。
- looper の実装はこのリポジトリに無い。`looper/state.md` の常設指示は、溜まったマージ候補を Codex レビューのあとマージしてよい、というもの。ラベルやタイトルで除外する仕組みは無い。この PR は draft のままにし、マージしない。
- 各エージェントからこのファイルを読ませるファイルは、別 PR に分けた。

### 2026-10-22 — ルールを各エージェントから読めるようにする

- `CLAUDE.md` は `@AGENTS.md` だけ。`.claude/settings.json` は `.env` と `.env.*` の Read を拒否する。フックは置かない。
- `GEMINI.md` は `@./AGENTS.md` だけ。`context.fileName` を変える設定は置かない。既定の GEMINI.md と二重に読ませないため。
- `.github/copilot-instructions.md` はポインタだけ。GitHub.com の Copilot Chat は `AGENTS.md` を読まない。
- Codex と Cursor はルートの `AGENTS.md` を読むので、追加ファイルは置かない。
- Codex CLI 0.163.0 の `codex debug prompt-input` は、分割後の `AGENTS.md` 全文を `# AGENTS.md instructions for /workspace` に入れた。5084 bytes で、既定の 32 KiB には収まる。
- Claude Code 2.1.308 の `claude -p` は未ログインでモデル応答の前に止まった。セッションのプロジェクト指示には `CLAUDE.md` と import 先の `AGENTS.md` が載り、deny 2 件は projectSettings に適用された。
- Gemini CLI は起動していない。
- この PR も draft。looper に、ラベルやタイトルで PR を除外する仕組みは無い。
