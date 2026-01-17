# 認証・セキュリティ

## 認証方式

### 1. メール/パスワード認証

- パスワード: bcryptでハッシュ化（cost 10）
- 最小6文字

### 2. Google OAuth SSO

- NextAuth.jsを使用
- 初回ログイン時にユーザー自動作成
- `password_hash`はNULL

### 3. Chrome拡張用トークン

- ユーザーごとに固有のトークンを発行
- `users.auth_token`に保存
- 設定ページで確認・コピー可能

## セッション管理

### Webセッション

- NextAuth.jsのセッショントークン（Cookie）
- JWTベース
- 有効期限: 7日

### API認証

```
Authorization: Bearer {token}
```

またはCookieベースのセッション。

## 環境変数

`.env.local`に設定:

```bash
# NextAuth
NEXTAUTH_URL=https://butsuyokuoh.exe.xyz:8000
NEXTAUTH_SECRET=<ランダム文字列>

# Google OAuth (オプショナル)
GOOGLE_CLIENT_ID=<Google Cloud Consoleから取得>
GOOGLE_CLIENT_SECRET=<Google Cloud Consoleから取得>

# JWT
JWT_SECRET=<ランダム文字列>
```

## セキュリティ設計

### データ分離

- 全てのクエリに`user_id`条件を付加
- 他ユーザーのデータにアクセス不可

### 入力バリデーション

- URL形式チェック
- ファイルタイプチェック（画像のみ）
- ファイルサイズ制限（5MB）

### HTTPS

- exe.devプロキシでSSL終端
- Let's Encrypt証明書

### CORS

- 同一オリジンのみ許可
- Chrome拡張はトークン認証

## Google OAuth設定手順

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクト作成
2. 「APIとサービス」→「認証情報」
3. 「OAuth同意画面」を設定
4. 「認証情報を作成」→「OAuthクライアントID」
5. アプリケーションの種類: 「ウェブアプリケーション」
6. 承認済みリダイレクトURI:
   - `https://butsuyokuoh.exe.xyz:8000/api/auth/callback/google`
7. クライアントIDとシークレットを`.env.local`に設定

## トラブルシューティング

### 「ログインに失敗しました」

- メールアドレスが存在するか確認
- パスワードが正しいか確認
- Google OAuthユーザーはパスワードログイン不可

### 「Googleログインが動作しない」

- `GOOGLE_CLIENT_ID`と`GOOGLE_CLIENT_SECRET`が設定されているか確認
- リダイレクトURIが正しく設定されているか確認
- サーバー再起動が必要

### 「Chrome拡張が認証できない」

- トークンが正しくコピーされているか確認
- サーバーURLが正しいか確認（末尾の/に注意）
