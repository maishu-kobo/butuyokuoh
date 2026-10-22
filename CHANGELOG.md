# Changelog

このファイルの形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従う。

## [Unreleased]

### Added

- 選んだ写真の候補を、1つの比較グループとしてリストに登録できるようにした。
- 写真の見た目から商品を推定する（Cloudflare Workers AI）。上限や判定できないときは商品名の入力に戻る。
- エージェント共通の開発ルール `AGENTS.md`。
- Claude Code、Gemini CLI、GitHub.com の Copilot Chat が `AGENTS.md` を読むためのポインタ。Claude Code の共有設定で `.env` と `.env.*` の読み取りを拒否する。
