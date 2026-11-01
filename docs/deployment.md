# デプロイガイド

exe.dev環境への本番デプロイ手順。

## 前提

- exe.dev VMにSSHアクセス可能
- Node.js 22.12 以上、npm 10.x インストール済み。22.12 未満では `npm install` に進まない
- systemdが利用可能

本番の Node.js は 22.12 以上にする。puppeteer 25 は `engines.node >=22.12.0` を要求する。Node.js 20 では価格チェックのブラウザが起動しない。上げる作業はこのリポジトリの外で行う。

`npm install` の直後は、同じディレクトリで `npm rebuild better-sqlite3` を実行する。better-sqlite3 はネイティブアドオンで、今の Node.js 向けに作り直してからビルドと起動をする。更新では、この2つを動いているアプリのディレクトリでは実行しない。手順は「安全な更新」。

価格取得の Chrome は、まずサンドボックス付きで起動する。Ubuntu 23.10 以降で非特権の user namespace が禁止されているとき、または systemd の `RestrictNamespaces=true` のとき、Chrome は起動前に `No usable sandbox!` で止まる。その失敗のときだけ `--no-sandbox` と `--disable-setuid-sandbox` で一度だけ起動し直す。ほかの起動失敗ではやり直さない。`PUPPETEER_DANGEROUS_NO_SANDBOX` は置かない。

---

## 初回デプロイ

### 1. ソースコードの配置

```bash
cd /home/exedev
git clone https://github.com/maishu-kobo/butuyokuoh.git
cd butuyokuoh
```

### 2. 依存関係のインストール

Node.js 22.12 以上を確認してから入れる。未満ならここで止める。`npm install` の直後に `npm rebuild better-sqlite3` を実行する。

```bash
node -e 'const p=process.versions.node.split(".").map(Number); if (p[0] < 22 || (p[0] === 22 && p[1] < 12)) { console.error("Node.js 22.12 以上が必要です: " + process.versions.node); process.exit(1); }'
npm install
npm rebuild better-sqlite3
```

### 3. 環境変数の設定

`.env.local`を作成:

```bash
# NextAuth設定
NEXTAUTH_URL=https://butsuyokuoh.exe.xyz
NEXTAUTH_SECRET=<openssl rand -base64 32で生成>

# JWT
JWT_SECRET=<openssl rand -base64 32で生成>

# Google OAuth（任意）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

**JWT_SECRETは本番（NODE_ENV=production）で必須。** 未設定の場合、トークンの発行・検証が
`JWT_SECRET environment variable must be set in production` というエラーで失敗し、
ログイン・拡張機能連携が動作しない（公開フォールバック鍵によるトークン偽造を防ぐためのフェイルファスト）。
`openssl rand -base64 32` で生成した値を`.env.local`または systemd unit の`Environment=`で設定すること。

### 4. ビルド

```bash
npm run build
```

### 5. systemdサービスの設定

サービスファイルを作成:

```bash
sudo tee /etc/systemd/system/butuyokuoh.service << 'EOF'
[Unit]
Description=Butuyokuoh - Wishlist Manager
After=network.target

[Service]
Type=simple
User=exedev
WorkingDirectory=/home/exedev/butuyokuoh
Environment=PORT=8000
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

### 6. サービスの有効化・起動

```bash
sudo systemctl daemon-reload
sudo systemctl enable butuyokuoh
sudo systemctl start butuyokuoh
```

### 7. 動作確認

```bash
systemctl status butuyokuoh
curl http://localhost:8000
```

外部アクセス: https://butsuyokuoh.exe.xyz/

---

## 価格チェックタイマーの設定

6時間ごとに自動で価格をチェックし、通知を送信する。

### サービスファイル

```bash
sudo tee /etc/systemd/system/butuyokuoh-price-check.service << 'EOF'
[Unit]
Description=Butuyokuoh Price Check
After=network.target

[Service]
Type=oneshot
User=exedev
WorkingDirectory=/home/exedev/butuyokuoh
ExecStart=/usr/bin/npm run check-prices
StandardOutput=journal
StandardError=journal
EOF
```

### タイマーファイル

```bash
sudo tee /etc/systemd/system/butuyokuoh-price-check.timer << 'EOF'
[Unit]
Description=Run Butuyokuoh Price Check every 6 hours (JST)

[Timer]
# JST 00:00, 06:00, 12:00, 18:00 = UTC 15:00, 21:00, 03:00, 09:00
OnCalendar=*-*-* 03,09,15,21:00:00
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF
```

### タイマーの有効化

```bash
sudo systemctl daemon-reload
sudo systemctl enable butuyokuoh-price-check.timer
sudo systemctl start butuyokuoh-price-check.timer
```

### 確認

```bash
# タイマー状態
systemctl list-timers | grep butuyokuoh

# 手動実行テスト
sudo systemctl start butuyokuoh-price-check.service
journalctl -u butuyokuoh-price-check -f
```

---

## 更新デプロイ

### ブランチの昇格

機能は `feature/* → develop → main` の順でPRを作り、CIとレビューを確認して統合する。本番へ配置するコードは `main` の検証済みコミットにそろえる。`main` 向けPRにも単体・型・Lint・ビルド・Playwright・依存・秘密情報・CodeQL検査を実行する。main側に先行した更新があり、squashマージ後にも競合が残る場合は、developから昇格用ブランチを作る。そのブランチへmainを取り込み、両方の更新を保持して競合を解消したうえでmain向けPRを作り、CIとレビューを確認する。

写真APIのキーはソースに含めず、本番VMの `CAPTURE_SECRETS_FILE` に設定する。コードの配置と写真機能の有効化は別々に確認する。

### 安全な更新

動いている DB は、ファイルのコピーではなく SQLite の `.backup` で写す。`.backup` はバックアップ API を使い、WAL にだけある更新も一貫した1つのファイルに入る。`data/butuyokuoh.db` だけをコピーすると、`-wal` に残った分が写らない。

準備のあいだアプリは止めない。`git pull`、`npm install`、`npm run build` は、動いているディレクトリ `/home/exedev/butuyokuoh` では実行しない。ここで `npm install` すると、動いているプロセスが使っている `node_modules` が途中で入れ替わり、更新の途中でアプリが落ちる。依存のインストールとビルドは `/home/exedev/butuyokuoh-next` で終わらせ、そのあと短い停止でディレクトリを入れ替える。

Node.js は 22.12 以上が必要である。`package.json` の `engines.node` は `>=22.12.0`。22.12 未満では、下のインストールに進まない。`npm install` の直後に、同じ別ディレクトリで `npm rebuild better-sqlite3` を実行してから `npm run build` する。

写真 API のキーはソースに含めず、本番 VM の `CAPTURE_SECRETS_FILE` に置いたままにする。このファイルはリポジトリの外なので、ディレクトリの入れ替えでは動かさない。

`PRAGMA integrity_check` が `ok` 以外なら、そこで止める。インストールかビルドが失敗したときは、サービスはまだ止めていない。`/home/exedev/butuyokuoh-next` を消して、動いているディレクトリはそのままにする。

配置するコミットは、CI とレビューを終えた main のコミットに合わせる。main の先端でなければ、clone のあと `git -C "$NEXT" checkout --detach <SHA>` でそのコミットにする。

```bash
set -euo pipefail

# Node.js 22.12 以上。未満ならここで止める。アプリは動かしたまま。
node -e 'const p=process.versions.node.split(".").map(Number); if (p[0] < 22 || (p[0] === 22 && p[1] < 12)) { console.error("Node.js 22.12 以上が必要です: " + process.versions.node); process.exit(1); }'

APP=/home/exedev/butuyokuoh
NEXT=/home/exedev/butuyokuoh-next
PREV=/home/exedev/butuyokuoh.prev

# アプリは動かしたまま写す。ファイルのコピーは使わない。
sqlite3 "$APP/data/butuyokuoh.db" ".backup '$APP/data/butuyokuoh.db.pre-update.online.backup'"
test "$(sqlite3 "$APP/data/butuyokuoh.db.pre-update.online.backup" "PRAGMA integrity_check;")" = "ok"

# 別ディレクトリへ新しい main を置く。動いている作業ツリーは checkout しない。
rm -rf "$NEXT"
git clone --branch main https://github.com/maishu-kobo/butuyokuoh.git "$NEXT"
cp -a "$APP/.env.local" "$NEXT/.env.local"

# 依存とビルドは別ディレクトリだけ。npm install の直後にネイティブアドオンを作り直す。
cd "$NEXT"
npm install
npm rebuild better-sqlite3
npm run build

# $PREV.new が残っているときは消さない。data を動かす前に確認する。
# ここで止まれば、サービスは動いたままで、DB は元のディレクトリにある。
test ! -e "$PREV.new"

# 準備が終わってから、短い停止で入れ替える。
sudo systemctl stop butuyokuoh-price-check.timer
sudo systemctl stop butuyokuoh-price-check.service
sudo systemctl stop butuyokuoh-guest-cleanup.timer || true
sudo systemctl stop butuyokuoh-guest-cleanup.service || true
sudo systemctl stop butuyokuoh

sqlite3 "$APP/data/butuyokuoh.db" ".backup '$APP/data/butuyokuoh.db.pre-update.backup'"
test "$(sqlite3 "$APP/data/butuyokuoh.db.pre-update.backup" "PRAGMA integrity_check;")" = "ok"

mv "$APP/data" "$NEXT/data"
if [ -d "$APP/public/uploads" ]; then
  rm -rf "$NEXT/public/uploads"
  mv "$APP/public/uploads" "$NEXT/public/uploads"
fi

mv "$APP" "$PREV.new"
mv "$NEXT" "$APP"
rm -rf "$PREV"
mv "$PREV.new" "$PREV"

sudo systemctl start butuyokuoh
sudo systemctl start butuyokuoh-price-check.timer
sudo systemctl start butuyokuoh-guest-cleanup.timer || true

# Type=simple は next start がポート 8000 を開く前に返る。
# 起動中の接続失敗では戻さない。30秒まで待って、それでも応答が無いときだけ失敗にする。
ready=0
for _ in $(seq 1 30); do
  if curl -fsS http://localhost:8000 >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" = 1
```

ゲスト清掃のタイマーとサービスは、この手順に入っている。ユニットを入れていない VM では `|| true` で続ける。入れている VM では、入れ替えの前にタイマーと実行中の oneshot を止め、入れ替えのあとと戻しのあとにタイマーを起動する。価格チェックのタイマーは、このガイドで有効にしていれば止めて、入れ替えのあとで戻す。`butuyokuoh` は Type=simple なので、`systemctl start` は `next start` がポート 8000 を開く前に返る。応答があるまで 30 秒を上限に待つ。その上限まで応答が無いときだけ、次の戻し方にする。起動の途中の接続失敗では戻さない。戻すと、新しいコードが起動したあとの書き込みは、止めた直後の `.backup` に戻る。スキーマが変わった DB は、コードを戻すだけでは戻らない。起動する前に、その写しから `.backup` で戻す。

```bash
set -euo pipefail

sudo systemctl stop butuyokuoh-price-check.timer
sudo systemctl stop butuyokuoh-price-check.service
sudo systemctl stop butuyokuoh-guest-cleanup.timer || true
sudo systemctl stop butuyokuoh-guest-cleanup.service || true
sudo systemctl stop butuyokuoh

rm -rf /home/exedev/butuyokuoh.prev/data
mv /home/exedev/butuyokuoh/data /home/exedev/butuyokuoh.prev/data
if [ -d /home/exedev/butuyokuoh/public/uploads ]; then
  rm -rf /home/exedev/butuyokuoh.prev/public/uploads
  mv /home/exedev/butuyokuoh/public/uploads /home/exedev/butuyokuoh.prev/public/uploads
fi

rm -rf /home/exedev/butuyokuoh-failed
mv /home/exedev/butuyokuoh /home/exedev/butuyokuoh-failed
mv /home/exedev/butuyokuoh.prev /home/exedev/butuyokuoh

rm -f /home/exedev/butuyokuoh/data/butuyokuoh.db-wal /home/exedev/butuyokuoh/data/butuyokuoh.db-shm
sqlite3 /home/exedev/butuyokuoh/data/butuyokuoh.db.pre-update.backup ".backup '/home/exedev/butuyokuoh/data/butuyokuoh.db'"
test "$(sqlite3 /home/exedev/butuyokuoh/data/butuyokuoh.db "PRAGMA integrity_check;")" = "ok"

sudo systemctl start butuyokuoh
sudo systemctl start butuyokuoh-price-check.timer
sudo systemctl start butuyokuoh-guest-cleanup.timer || true
```

---

## 運用コマンド

### サービス管理

| コマンド | 説明 |
|---------|------|
| `systemctl status butuyokuoh` | 状態確認 |
| `systemctl restart butuyokuoh` | 再起動 |
| `systemctl stop butuyokuoh` | 停止 |
| `journalctl -u butuyokuoh -f` | ログ確認（リアルタイム） |
| `journalctl -u butuyokuoh --since "1 hour ago"` | 直近1時間のログ |

### データベース

```bash
# スキーマを変える前。手順の詳細は docs/database.md の「スキーマ変更の前のバックアップ」
sudo systemctl stop butuyokuoh
sqlite3 data/butuyokuoh.db ".backup 'data/butuyokuoh.db.pre-migrate.backup'"
sqlite3 data/butuyokuoh.db.pre-migrate.backup "PRAGMA integrity_check;"

# ファイルコピーは使わない。WAL が別ファイルに残る。通常の更新の写しは「安全な更新」

# 確認
sqlite3 data/butuyokuoh.db "SELECT COUNT(*) FROM items;"

# この場ではスキーマを変えない。確認が終わったら起動し直す。
# 新しいコードを入れる前の止め方は docs/database.md
sudo systemctl start butuyokuoh
```

### ディスク使用量

```bash
du -sh data/
du -sh public/uploads/
```

---

## HTTPS（exe.dev）

exe.devのプロキシが自動でHTTPS終端を行う。

- 内部: `http://localhost:8000`
- 外部: `https://butsuyokuoh.exe.xyz`

追加設定は不要。

---

## トラブルシューティング

### サービスが起動しない

```bash
journalctl -u butuyokuoh -n 50
```

よくある原因:
- `npm run build`していない
- `.env.local`が存在しない
- ポートが使用中

### ポート競合

```bash
lsof -i :8000
kill <PID>
```

### メモリ不足

Puppeteerがメモリを多く消費する。`dmesg`でOOM Killerを確認:

```bash
dmesg | grep -i oom
```

### 価格チェックが動かない

```bash
# 手動実行でエラー確認
cd /home/exedev/butuyokuoh
npm run check-prices
```

## ゲスト体験

ゲストモードの有効化、保存期限・件数上限、毎時の清掃タイマー、停止手順は [guest-mode.md](guest-mode.md) を参照する。
初期状態は無効。本番環境で匿名アクセス・Google OAuth・Cookie・清掃の動作を確認したうえで有効にする。
