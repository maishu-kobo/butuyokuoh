# feature/photo-capture を試す

チームが `feature/photo-capture` を試す手順。本番では試さない。本番の URL は開かない。本番のデータベースは使わない。

いちばん簡単なのは [A](#a-sota-さんの-mac-を使う)。自分の PC で動かすのは [B](#b-自分の-pc-で動かす)。見る項目は [C](#c-何を確かめるか)。不具合の伝え方は [D](#d-不具合の報告)。

ホスト名、メールアドレス、鍵の値は、この手順書に書かない。

## A. Sota さんの Mac を使う

Sota さんの Mac 上の開発サーバを、Tailscale の HTTPS で開く。相手を tailnet に招待しない。Tailscale のマシン共有で、その Mac だけを渡す。説明は [Share your machines with other users](https://tailscale.com/kb/1084/sharing) に沿う。

共有された Mac は隔離（quarantine）されている。メンバーの端末へ、その Mac から接続はできない。メンバーから届くのは、下の grants で許した 443 番だけ。

データは Sota さんの Mac のローカル DB に入る。本番には入らない。写真検索は Sota さんの Cloudflare / Yahoo! の枠を使う。招待はいつでも取り消せる。

### Sota さん側

共有できるのは、その tailnet の Owner、Admin、IT admin。

Share する前に、その Mac の `JWT_SECRET` を自分で作って置く。未設定のフォールバックのまま、その Mac を共有しない。本番の値は使わない。

```bash
openssl rand -base64 32
```

出た文字列は `.env.local` の `JWT_SECRET` に入れる。チャットやコミットに貼らない。この手順書にも書かない。入れたら開発サーバを起動し直してから、次へ進む。

1. [admin console](https://login.tailscale.com/admin/machines) の Machines を開く。
2. 開発サーバが動いている Mac だけを選ぶ。ほかのマシンは Share しない。
3. その Mac のメニューから Share を開く。招待はメールかリンク。
   - メール: Share by email に宛先を書いて Share。届くリンクは1回限り。宛先のメールアドレスは、この手順書にもチャットにもコミットにも書かない。
   - リンク: Copy invite link。使い捨てのリンクか、複数回使えるリンクを選べる。未使用のリンクは 30 日で切れる。招待リンクはパスワードと同じ扱い。チャットやコミットに貼らない。
4. メンバーには、別に「Sota さんから共有された URL」を渡す。その URL のホスト名は、この手順書に書かない。
5. Google Cloud の OAuth 同意画面が「テスト中」なら、メンバーの Gmail をテストユーザーに足す。足すまで、その人の Google ログインは拒否される。Gmail のアドレスは、この手順書にもチャットにもコミットにも書かない。

tailnet policy の grants では、`autogroup:shared`（マシン共有を受け入れた人）に 443 番だけを許す。80 番も、Mac のほかのポートも許さない。

`"src": ["*"]` で `"ip": ["*"]` の grant が残っていると、共有先にも Mac のほかのポートが開く。自分の tailnet のメンバーと、共有先を分ける。

```json
"grants": [
  {
    "src": ["autogroup:member"],
    "dst": ["*"],
    "ip": ["*"]
  },
  {
    "src": ["autogroup:shared"],
    "dst": ["*"],
    "ip": ["443"]
  }
]
```

`autogroup:shared` の `dst` が `*` でも、Share した Mac 以外には届かない。ポートは `443` だけなので、その Mac のほかのポートには届かない。今の policy に、自分の tailnet で必要な別の grant があるときは残す。共有先に全ポートを許す規則は残さない。

取り消すときも Machines から、その Mac の Share を開き、Revoke invite。取り消したあとは、その人から Mac へ届かなくなる。戻すには新しい招待が要り、相手がもう一度受け入れる。

### メンバー側

受け入れる人は、自分の tailnet の Owner、Admin、IT admin。

1. 招待メールかリンクを開く。自分の Tailscale アカウントでログインし、その Mac の共有を受け入れる。tailnet へのユーザー招待は受け入れない。
2. 受け入れた Mac が、自分の Tailscale に出る。その Mac から、自分のほかの端末へは接続できない。
3. Sota さんから共有された URL を、ブラウザで開く。ホスト名は自分で調べて書かない。
4. ゲストでは入らない。「Googleでログイン」を押し、自分の Google アカウントで入る。新しい会員アカウントが、Sota さんの Mac のローカル DB に作られる。同意画面が「テスト中」で拒否されたら、Sota さんにテストユーザー追加を頼む。アドレスはチャットに貼らない。

登録した商品と写真の検索は、その Mac のローカル DB と、Sota さんの Cloudflare / Yahoo! の枠に入る。本番のリストには増えない。

## B. 自分の PC で動かす

Node.js は 22.12 以上。

```bash
git clone https://github.com/maishu-kobo/butuyokuoh.git
cd butuyokuoh
git checkout feature/photo-capture
npm ci
```

鍵の値は、Sota さんから安全な方法で受け取る。チャットやコミットに貼らない。この手順書にも書かない。本番のデータベースと本番の URL は使わない。

値の置き場は、リポジトリに入らない `.env.local`。写真検索の鍵だけを分けるときは、リポジトリの外にモード 0600 のファイルを作り、`CAPTURE_SECRETS_FILE` でそのパスを指す。そのファイルから読むのは `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`YAHOO_SHOPPING_APP_ID`、`RAKUTEN_APP_ID`、`RAKUTEN_ACCESS_KEY`、`AMAZON_ASSOCIATE_TAG` だけ。同じ名前が環境変数にあるときは、環境変数が勝つ。

`npm run dev` のあと、初回に `data/butuyokuoh.db` ができる。これが自分の PC の開発用 DB。`BUTUYOKUOH_DB_PATH` を本番のファイルや、そのコピーに向けない。未設定のままにする。

`NEXTAUTH_URL` と `AUTH_URL` に本番の URL を入れない。自分の PC のブラウザだけなら `http://localhost:3000`。スマホから開くときは、下の `tailscale serve` が表示した URL にする。ホスト名はここに書かない。

`AUTH_SECRET`（または `NEXTAUTH_SECRET`）と `JWT_SECRET` は、自分の PC で作る。本番の値は置かない。`JWT_SECRET` は、共有と `tailscale serve` の前に必須である。未設定でも開発サーバは起動するが、そのときはリポジトリに入っているフォールバックで会員トークンを署名する。未設定のフォールバックのまま公開しない。

```bash
openssl rand -base64 32
```

出た文字列を `.env.local` の `JWT_SECRET` に入れる。`AUTH_SECRET` 用には、別に1回作る。チャットやコミットに貼らない。この手順書にも書かない。

| 名前 | いつ要るか |
| --- | --- |
| `CAPTURE_ENABLED` | 必須。値が `true` のときだけ入口が出る |
| `CAPTURE_AI_ENABLED` | 必須。値が `true` で、かつ `CAPTURE_ENABLED` も `true` のときだけ写真から商品名を推定する |
| `CLOUDFLARE_ACCOUNT_ID` | 必須。Cloudflare Workers AI |
| `CLOUDFLARE_API_TOKEN` | 必須。Workers AI の Read |
| `YAHOO_SHOPPING_APP_ID` | 必須。Yahoo!ショッピングの商品検索 |
| `DEV_ALLOWED_ORIGINS` | スマホや別の端末から開くとき。development だけ有効 |
| `AUTH_SECRET` または `NEXTAUTH_SECRET` | 自分の PC で作る。本番の値は使わない |
| `NEXTAUTH_URL` または `AUTH_URL` | 開く URL。本番の URL は入れない |
| `GOOGLE_CLIENT_ID` | 自分の PC で「Googleでログイン」するときだけ |
| `GOOGLE_CLIENT_SECRET` | 上と同じ。同意画面が「テスト中」なら、自分の Gmail をテストユーザーに足す |
| `RAKUTEN_APP_ID` | 無くてよい。楽天を使うときだけ、`RAKUTEN_ACCESS_KEY` と両方 |
| `RAKUTEN_ACCESS_KEY` | 無くてよい。URL には付かない |
| `AMAZON_ASSOCIATE_TAG` | 無くてよい。Amazon の検索リンクに付けるタグ。商品の取得には使わない |
| `CAPTURE_SECRETS_FILE` | 上の6つの鍵を、リポジトリの外のファイルに置くとき |
| `JWT_SECRET` | 必須。共有と `tailscale serve` の前に、`openssl rand -base64 32` で自分で作る。未設定のフォールバックのまま公開しない。本番の値は置かない |
| `BUTUYOKUOH_DB_PATH` | 置かない。本番の DB を指させない |

`CAPTURE_TEST_HOOKS` と `CAPTURE_FAKE_SCENARIO` は付けない。テスト用の偽物になる。

```bash
npm run dev
```

PC のブラウザは http://localhost:3000 。ゲストのままでは「写真から登録」が出ない。画面から会員登録するか、Google の鍵を受け取っているなら「Googleでログイン」する。

スマホから開くとき。自分の PC と自分のスマホが、同じ自分の tailnet に入っていること。Sota さんの Mac の共有は使わない。

`tailscale serve` の前に、自分で作った `JWT_SECRET` が入っていること。未設定のフォールバックのまま出さない。入れたあとなら、開発サーバを起動し直してから実行する。

```bash
tailscale serve --bg 3000
```

表示されたホスト名を `DEV_ALLOWED_ORIGINS` に書く。`https://` やポートが付いていても、使うのはホスト名だけ。カンマ区切りで複数書ける。同じ LAN の IP から開くときも、その IP を入れる。未設定または空なら、開発サーバ自身のホスト名と localhost だけが許される。書いたら `npm run dev` を起動し直す。

iPhone Safari と Android Chrome で、`tailscale serve` が表示した HTTPS の URL を開く。

## C. 何を確かめるか

試すブランチは `feature/photo-capture`。報告には、試した commit を書く。入口は「新しいアイテムを追加」。

会員で開く。ゲストには「写真から登録」が出ない。A では Sota さんの Mac の `CAPTURE_ENABLED=true` と `CAPTURE_AI_ENABLED=true`、Yahoo! のキーがあること。楽天のキーは無くてよい。B では自分でそれを置く。

### Safari の描画ずれ

「新しいアイテムを追加」を開いた直後を見る。

- 画面がちらつかない。「写真から登録」が、一度メニュー付きで出てから消える、またはその逆にならない。Safari のコンソールに Hydration failed、didn't match、won't be patched up が出ない。
- PC: 描画が済んだあと、ボタンはメニューを持つ。「写真から登録」で「カメラで撮る」と「ファイル/写真を選ぶ」が出る。
- iPhone Safari と Android Chrome: 描画が済んだあともメニュー属性は付かない。「写真から登録」で OS の選択シートが開く。アプリ内メニューは出ない。

### 端末ごとの入口

- PC: 「写真から登録」でメニュー。「カメラで撮る」と「ファイル/写真を選ぶ」。カードへ1枚ドロップしてもよい。
- iPhone Safari: 「写真から登録」で OS の選択シート（カメラ、ライブラリ、ファイル）。メニューとは案内しない。
- Android Chrome: iPhone と同じ。OS の選択シート。

共通: JPEG、PNG、WebP、HEIC、HEIF を1枚。長辺 1600px の JPEG に縮小。5MB を超えると「写真は5MBまでです」で送らない。進みは「写真を送っています」「商品を推定しています」「候補を探しています」。15秒を超えたらやり直すか手入力。

### 候補画面

- 「Amazonで探す」と「選んだ候補を登録」の間に間隔がある。
- 「この名前で探す」が、「おすすめ順」「安い順」と揃った、押せるボタンに見える。

### どの端末でも

1. 候補。画像、ショップ名、商品名、価格、日本時間の取得時刻、商品ページが出る。本体が付属品より前。充電ケース付きの AirPods のような本体が、クエリの「-ケース」で消えない。ケースだけの商品は強い付属品として落ちてよい。楽天の候補が無くても失敗にしない。
2. 候補を1件だけ登録する。リストは URL 登録と同じ1枚。左に画像、ショップ、優先度、商品名、価格、外部リンク。ボタンは「価格推移」「編集」「購入済みにする」「削除」。「価格を更新」があり、押すと 409 にならない。出費予定はインデントのない平らな1行。
3. 同じ商品を2店以上登録する。リストは1枚。開くと店ごとの価格。最安、価格の幅、件数が出る。「価格を更新」は出ない。出費予定は店ごとの平らな行で、見出しやインデントは無い。
4. そのグループで優先度、比較グループの保存、削除をする。今の base では、カードの削除は全店に効く。代表の1件だけではない。開いたショップの行に、店ごとの削除は無い。
5. 1件の登録をやり直しても、増えるのはその商品だけで、同じ URL の別商品までまとめて増えない。
6. 課題9が `feature/photo-capture` に入ってから確かめる。複数ショップのカードを開くと、ショップごとに削除がある。最後の1店は、グループごとゴミ箱へ入る。2店から1店になったら、1件登録と同じ表示に戻る。

### 失敗にしないもの

- 検索やカテゴリで2店グループの店が1件だけ見えると、「価格を更新」が出て API は 409 のまま。別タスク。
- 強い語の無い候補が1件でも混ざると、「充電ケース付き」のタイトルは候補から落ちることがある。今の動き。
- `docs/capture.md` は、Yahoo! の query と楽天の NGKeyword に除外語を足さない、と書いている。「写真の商品は価格チェックに載せない」は、今の動きと違う。実機の期待は、上の手順。

商品の動きの詳細は [写真から登録する](./capture.md)。

## D. 不具合の報告

次の3つを添える。

1. スクリーンショット。
2. 端末とブラウザ。
3. 手順。試した commit も書く。

鍵の値、招待リンク、メールアドレス、ホスト名は貼らない。
