import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { SessionContext } from 'next-auth/react';
import PrivacyPage from '../src/app/privacy/page';
import TermsPage from '../src/app/terms/page';
import { RootProviders } from '../src/components/RootProviders';
import LoginForm from '../src/components/LoginForm';
import { AuthContext, AuthProvider } from '../src/components/AuthProvider';

const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
  prefetch() {},
  experimental_gesturePush() {},
  bfcacheId: '_b_0_',
};

function html(node: ReactNode): string {
  return renderToStaticMarkup(node);
}

const overclaim = [
  '一切の責任',
  '準拠法',
  '損害賠償',
  '同意したものとみな',
  '個人情報保護法',
  'GDPR',
  '当社',
];

test('プライバシーポリシーは下書きで、アプリの扱いだけを書く', () => {
  const page = html(createElement(PrivacyPage));
  assert.match(page, /プライバシーポリシー（下書き）/);
  assert.match(page, /下書き。Sota の確認待ち。確定したプライバシーポリシーではありません。/);
  assert.match(page, /法律上の同意文や、法令への適合の宣言ではありません。/);
  assert.match(page, /パスワードは6文字以上です。保存するのは照合用のハッシュで、入力したパスワードそのものではありません。/);
  assert.match(page, /確認メールは送りません。/);
  assert.match(page, /Googleログインは、その設定があるときだけ画面に出ます。/);
  assert.match(page, /確認済みのGoogleアカウントのメールアドレス、名前、Googleの識別子を会員に結びつけます。/);
  assert.match(page, /同じメールの会員に結ぶと、その会員のパスワードは消します。/);
  assert.match(page, /商品名、URL、店舗の画像URL、価格、メモ、優先度、個数、購入予定日、購入済み、カテゴリ、比較グループを、このアプリが動いている場所のSQLiteに保存します。/);
  assert.match(page, /商品の価格を取りに行くときは、その商品URLのページを取得します。価格が変わったときは履歴に残します。/);
  assert.match(page, /まとめて行う価格の確認は、会員の未購入で、ゴミ箱に無く、商品コードが無く、写真の比較グループに入っていない商品が対象です。/);
  assert.match(page, /保存したSlackまたはDiscordのウェブフックがあり、通知がオンのときは、その宛先へ価格の通知を送ることがあります。/);
  assert.match(page, /会員がアップロードした画像は、位置情報などの付随データを落としてから保存します。/);
  assert.match(page, /写真から商品を判定するとき、写真はこのアプリへ届きます。/);
  assert.match(page, /使えるCloudflareのアカウントIDとAPIトークンが両方あるときだけ、その写真をCloudflareのWorkers AI（api.cloudflare.com）へ送ります。/);
  assert.match(page, /キーが無いとき、または使えないときは、写真をそこへは送りません。/);
  assert.match(page, /写真そのものはこのアプリのデータベースに保存しません。/);
  assert.match(page, /各回のニューロン数/);
  assert.match(page, /検索で見つけた候補は30分で消します。/);
  assert.match(page, /Yahoo!ショッピング（shopping.yahooapis.jp）と楽天市場（openapi.rakuten.co.jp）/);
  assert.match(page, /キーが無い店は使いません。/);
  assert.match(page, /ゲスト体験は、その設定があるときだけ使えます。メールアドレスは受け取りません。体験用の行には、利用者が入力していない仮の識別子を付けます。期限の標準は24時間で、設定で変わります。/);
  assert.match(page, /期限が切れるか体験を終えると、ゲストのデータを消します。会員のログインには引き継ぎません。/);
  assert.match(page, /butuyokuoh_token/);
  assert.match(page, /httpOnly、SameSite=Lax、有効期限は7日です。本番ではSecureを付けます。/);
  assert.match(page, /butuyokuoh_guest/);
  assert.match(page, /httpOnly、SameSite=Laxで、体験の期限までです。本番ではSecureを付けます。/);
  assert.match(page, /サーバに残すのはトークンのハッシュです。/);
  assert.match(page, /Googleログインのあいだは、ログイン状態を保つ別のクッキーをブラウザに置きます。/);
  assert.match(page, /表示テーマはブラウザのlocalStorageに保存することがあります。サーバには送りません。/);
  assert.match(page, /会員は、ほしいもの、購入済み、または全部をCSVで書き出せます。/);
  assert.match(page, /設定の退会は、会員のアカウント、商品、価格履歴、カテゴリ、比較グループ、通知設定、アップロード画像、写真検索の記録と回数を消します。元に戻す操作はありません。/);
  assert.match(page, /画面に、広告配信やアクセス解析の外部タグは入れていません。/);
  assert.match(page, /下書きの日付は2026-10-23です。/);
  assert.match(page, /href="\/terms"/);
  for (const phrase of overclaim) assert.equal(page.includes(phrase), false, phrase);
});

test('利用規約は下書きで、アプリがしていること以上の法的な主張を書かない', () => {
  const page = html(createElement(TermsPage));
  assert.match(page, /利用規約（下書き）/);
  assert.match(page, /下書き。Sota の確認待ち。確定した利用規約ではありません。/);
  assert.match(page, /画面に同意の確認は無く、この文面への同意を利用の条件にしていません。/);
  assert.match(page, /ほしいものの一覧、価格、メモ、写真からの候補を、自分の画面に残すアプリです。/);
  assert.match(page, /会員はメールアドレスと6文字以上のパスワードで作ります。名前は任意です。/);
  assert.match(page, /ゲスト体験は、その設定があるときだけ使えます。期限が切れるか体験を終えるとデータを消し、会員のログインには引き継ぎません。/);
  assert.match(page, /会員がログアウトすると、それまでのログインは使えなくなります。/);
  assert.match(page, /設定の退会は、アカウントと登録したデータを消します。元に戻す操作はありません。/);
  assert.match(page, /商品URLを登録したり価格を取り直したりすると、そのURLのページを取得します。/);
  assert.match(page, /写真から探すと、写真はこのアプリへ届きます。/);
  assert.match(page, /使えるCloudflareのアカウントIDとAPIトークンが両方あるときだけ、写真をCloudflareのWorkers AI（api.cloudflare.com）へ送ります。/);
  assert.match(page, /キーが無いとき、または使えないときは、そこへは送りません。/);
  assert.match(page, /写真自体は保存しません。/);
  assert.match(page, /このアプリの中に、代金を払う機能はありません。/);
  assert.match(page, /会員は自分のデータをCSVで書き出せます。/);
  assert.match(page, /下書きの日付は2026-10-23です。/);
  assert.match(page, /href="\/privacy"/);
  for (const phrase of overclaim) assert.equal(page.includes(phrase), false, phrase);
});

function authShell(pathname: string, child: ReactNode): string {
  return renderToStaticMarkup(createElement(
    SessionContext.Provider,
    { value: { data: null, status: 'loading', update: async () => null } },
    createElement(
      PathnameContext.Provider,
      { value: pathname },
      createElement(AuthProvider, null, child),
    ),
  ));
}

test('直接開いた最初の描画でも下書きの本文が出る', () => {
  const privacy = renderToStaticMarkup(createElement(RootProviders, null, createElement(PrivacyPage)));
  const terms = renderToStaticMarkup(createElement(RootProviders, null, createElement(TermsPage)));
  assert.match(privacy, /下書き。Sota の確認待ち。確定したプライバシーポリシーではありません。/);
  assert.match(terms, /下書き。Sota の確認待ち。確定した利用規約ではありません。/);
  assert.equal(privacy.includes('読み込み中...'), false);
  assert.equal(terms.includes('読み込み中...'), false);
});

test('認証待ちのあいだ、ほかの画面は隠れ、水和ページだけは出る', () => {
  const home = authShell('/', createElement('p', null, '会員の一覧'));
  assert.match(home, /読み込み中/);
  assert.equal(home.includes('会員の一覧'), false);

  const firstPaint = renderToStaticMarkup(createElement(
    SessionContext.Provider,
    { value: { data: null, status: 'loading', update: async () => null } },
    createElement(AuthProvider, null, createElement('p', null, '会員の一覧')),
  ));
  assert.match(firstPaint, /読み込み中/);
  assert.equal(firstPaint.includes('会員の一覧'), false);

  const hydration = authShell('/capture-hydration', createElement('p', null, '水和のピッカー'));
  assert.match(hydration, /水和のピッカー/);
  assert.equal(hydration.includes('読み込み中...'), false);
});

function loginMarkup(): string {
  const value = {
    user: null,
    token: null,
    loading: false,
    isGuest: false,
    guestEnabled: false,
    ttlHours: 24,
    googleLogin: false,
    startGuest: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
  return renderToStaticMarkup(createElement(AuthContext.Provider, { value }, createElement(LoginForm)));
}

test('ログイン画面から2つの下書きを開ける', () => {
  const page = loginMarkup();
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /プライバシーポリシー（下書き）/);
  assert.match(page, /利用規約（下書き）/);
});

test('設定画面から2つの下書きを開ける', async () => {
  const { default: SettingsPage } = await import('../src/app/(app)/settings/page');
  const value = {
    user: { id: 1, account_type: 'member' as const, email: 'member@example.com', name: '会員' },
    token: null,
    loading: false,
    isGuest: false,
    guestEnabled: false,
    ttlHours: 24,
    googleLogin: false,
    startGuest: async () => {},
    login: async () => {},
    register: async () => {},
    logout: async () => {},
  };
  const page = renderToStaticMarkup(createElement(
    AppRouterContext.Provider,
    { value: router },
    createElement(AuthContext.Provider, { value }, createElement(SettingsPage)),
  ));
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /プライバシーポリシー（下書き）/);
  assert.match(page, /利用規約（下書き）/);
});
