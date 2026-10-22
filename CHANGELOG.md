# Changelog

このファイルの形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従う。

## [Unreleased]

### Fixed

- 写真の判定で 5016 が返ったときは、追加のリクエストを送らず商品名の入力に戻る。
- 写真判定の1分・1日の回数と、全体のニューロンは SQLite に残す。再起動してもその日の上限は残る。`result.usage.neurons` を数え、無いときだけ 378 とする。

### Added

- 選んだ写真の候補を、1つの比較グループとしてリストに登録できるようにした。
- 写真の見た目から商品を推定する（Cloudflare Workers AI）。上限や判定できないときは商品名の入力に戻る。
- エージェント共通の開発ルール `AGENTS.md`。
- Claude Code、Gemini CLI、GitHub.com の Copilot Chat が `AGENTS.md` を読むためのポインタ。Claude Code の共有設定で `.env` と `.env.*` の読み取りを拒否する。
