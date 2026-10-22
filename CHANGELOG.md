# Changelog

このファイルの形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従う。

## [Unreleased]

### Added

- 写真から作った比較グループを、リストで1枚のカードにまとめて出す。最安と価格の幅を出し、開くとショップごとの一覧が出る。
- 選んだ写真の候補を、1つの比較グループとしてリストに登録できるようにした。
- エージェント共通の開発ルール `AGENTS.md`。
- Claude Code、Gemini CLI、GitHub.com の Copilot Chat が `AGENTS.md` を読むためのポインタ。Claude Code の共有設定で `.env` と `.env.*` の読み取りを拒否する。

### Changed

- 写真から登録した商品を、6時間ごとの価格チェックと再取得の対象から外した。
