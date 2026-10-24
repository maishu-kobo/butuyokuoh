# 3件のPRをまとめた検証環境

`codex/capture-preview` は `feature/photo-capture` に #196（Issue #193）、#197（Issue #194）、#198（Issue #195）を取り込んだ検証専用ブランチ。元のPRと共有ブランチは変更しない。#199 の監査例外修正も含む。

## 配置と起動

検証専用の exe.dev VM（WebはPrivate）で動かす。Node.js 22、SQLiteはこのVMの新規DB。実APIの秘密情報は未設定。

- アプリ: `/home/exedev/butuyokuoh-preview`
- Node.js: `/home/exedev/.local/node22/bin`
- 起動設定: `/home/exedev/.config/butuyokuoh-preview/app.env`（0600）
- API設定: `/home/exedev/.config/butuyokuoh-preview/capture-secrets.env`（0600）
- DB: `/home/exedev/butuyokuoh-preview/data/butuyokuoh.db`
- サービス: `butuyokuoh-preview.service`、ポート8000、自動起動・異常終了時再起動

```bash
sudo systemctl status butuyokuoh-preview --no-pager
sudo systemctl restart butuyokuoh-preview
```

固定データを使うため `npm run dev` で動かす。`NODE_ENV=development`、`CAPTURE_ENABLED=true`、`CAPTURE_AI_ENABLED=true`、`CAPTURE_TEST_HOOKS=1`、`CAPTURE_FAKE_SCENARIO=default`。本番起動ではテスト用フックは無効になる。ゲスト機能は無効。

## 画面で試す

1. exe.devのログインを済ませて検証URLを開く。アプリでも「新規登録」から検証用アカウントを作る。Googleログインは未設定。
2. 「新しいアイテムを追加」→「写真から登録」→画像を1枚選ぶ。何の画像でも、固定の商品名「テスト用ゲルボールペン 0.5」が返る。
3. Yahoo!の980円と楽天の1,200円、検索サービスのクレジットを確認する。候補の画像・商品URLは架空なので、画像が表示されないことやリンク先が存在しないことは想定内。外部商品リンクや「価格を更新」は今回の確認対象外。
4. 2件とも選び「選んだ候補を登録」。比較グループになる。
5. 「出費予定」で1,200円の行の「合計に数える」を選ぶ。再読み込み後も選択が残ることを確認する。
6. 「自動（最安）に戻す」で980円へ戻し、再読み込み後も自動選択が維持されることを確認する。

Amazonのタグは空にしてある。タグなし検索リンクとなり、参加者の表示は出ない。タグありの表示と失敗時のクレジットはPlaywrightでも検証する。架空のタグを実運用に設定しない。

候補ゼロ・片方の検索失敗を手動で試すには `app.env` の `CAPTURE_FAKE_SCENARIO` を `empty` / `yahoo-down` / `rakuten-down` / `both-down` に変更してサービスを再起動する。終わったら `default` に戻す。設定ファイルには認証秘密鍵もあるため内容をログやチャットへ貼らない。

## 実APIへの切り替え

`capture-secrets.env` に自分の検証用認証情報を入れる。ファイルの所有者は `exedev`、権限は0600を維持する。既存の本番や他の人の秘密鍵はコピーしない。

| 設定名 | 用途 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 写真認識用アカウントID（32桁の16進数） |
| `CLOUDFLARE_API_TOKEN` | 上のアカウントのWorkers AIを呼ぶトークン。既存手順はWorkers AI Read |
| `YAHOO_SHOPPING_APP_ID` | Yahoo!ショッピングの商品検索 |
| `RAKUTEN_APP_ID`、`RAKUTEN_ACCESS_KEY` | 楽天の2026-07-01版検索API。両方必要。楽天を使わない場合は空 |
| `RAKUTEN_AFFILIATE_ID` | 任意。通常の検索には不要 |
| `AMAZON_ASSOCIATE_TAG` | 任意。検索リンク用。Amazonから商品情報を取得する鍵ではない |

楽天には検証URLのドメイン、および必要ならVMの外向きIPを登録する。アプリは画面のHTTPS OriginをRefererとして送る。Sotaさんの環境ではIPの許可で成功した記録があるが、新VMでは未確認（Issue #82）。楽天とAmazonタグ付きリンクの併記条件も同Issueで未解決なので、タグは空のままでよい。

キーを設定しただけではテストモードは解除されない。`app.env` の `CAPTURE_TEST_HOOKS=1` を `CAPTURE_TEST_HOOKS=0` に変更し、`CAPTURE_FAKE_SCENARIO` を削除して再起動する。この検証環境では開発起動のまま実API連携を試せる。

```bash
sudo systemctl restart butuyokuoh-preview
```

画像を1枚選び、固定のテスト商品ではなく実際の推定名と検索候補が返ることを確認する。テストに使った架空候補は実商品ではないので混同しない。固定データへ戻す場合は実APIのキーを空にしてから、`CAPTURE_TEST_HOOKS=1`、`CAPTURE_FAKE_SCENARIO=default` に戻す。AIはテストフックが有効でも有効なキーがあると実通信する経路があるため、フラグだけで切り戻さない。

Googleログインを使う場合だけ `app.env` に `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` を追加し、Google側に検証URLの `/api/auth/callback/google` を許可する。メール・パスワードの会員登録だけなら不要。

## コミット前チェック（Issue #195）

これはWebの機能ではなく、開発者のチェックアウトで試す。希望する開発者が `npm run hooks:install` を実行する。解除は `npm run hooks:uninstall`。同じリポジトリのworktreeで設定を共有するので、使い捨てcloneで試すと影響を限定できる。今回のデプロイでは手元やVMのフックを自動有効化しない。

## 統合時の検証

2026-10-24: 単体テスト422件成功、型検査・ビルド成功、Lintはエラー0件（既存警告23件）。`capture-flow.spec.ts` と `capture-photo-group.spec.ts` のPlaywright計9件成功。#199を含むため、前回の古い監査例外によるテスト失敗も解消している。実API接続はキー未設定のため未確認。
