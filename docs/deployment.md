# デプロイガイド

exe.dev環境への本番デプロイ手順。

## 前提

- exe.dev VMにSSHアクセス可能
- Node.js 20.x、npm 10.x インストール済み
- systemdが利用可能

---

## 初回デプロイ

### 1. ソースコードの配置

```bash
cd /home/exedev
git clone https://github.com/maishu-kobo/butuyokuoh.git
cd butuyokuoh
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. 環境変数の設定

`.env.local`を作成:

```bash
# NextAuth設定
NEXTAUTH_URL=https://butsuyokuoh.exe.xyz:8000
NEXTAUTH_SECRET=<openssl rand -base64 32で生成>

# JWT
JWT_SECRET=<openssl rand -base64 32で生成>

# Google OAuth（任意）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

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

外部アクセス: https://butsuyokuoh.exe.xyz:8000/

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

### 通常の更新

```bash
cd /home/exedev/butuyokuoh
git pull
npm install
npm run build
sudo systemctl restart butuyokuoh
```

### ワンライナー

```bash
cd /home/exedev/butuyokuoh && git pull && npm install && npm run build && sudo systemctl restart butuyokuoh
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
# バックアップ
cp data/butuyokuoh.db data/butuyokuoh.db.backup.$(date +%Y%m%d)

# 確認
sqlite3 data/butuyokuoh.db "SELECT COUNT(*) FROM items;"
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
- 外部: `https://butsuyokuoh.exe.xyz:8000`

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
