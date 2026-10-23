import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyPage from '../src/app/privacy/page';
import TermsPage from '../src/app/terms/page';
import LoginForm from '../src/components/LoginForm';
import { AuthContext } from '../src/components/AuthProvider';

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
  },
});

function visible(node: ReactNode): string {
  return renderToStaticMarkup(node).replace(/<[^>]+>/g, '');
}

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
  const body = visible(createElement(PrivacyPage));
  assert.match(body, /プライバシーポリシー（下書き）/);
  assert.match(body, /下書き。Sota の確認待ち。確定したプライバシーポリシーではありません。/);
  assert.match(body, /法律上の同意文や、法令への適合の宣言ではありません。/);
  assert.match(body, /パスワードは6文字以上です。保存するのは照合用のハッシュで、入力したパスワードそのものではありません。/);
  assert.match(body, /確認メールは送りません。/);
  assert.match(body, /Googleログインは、その設定があるときだけ画面に出ます。/);
  assert.match(body, /確認済みのGoogleアカウントのメールアドレス、名前、Googleの識別子を会員に結びつけます。/);
  assert.match(body, /同じメールの会員に結ぶと、その会員のパスワードは消します。/);
  assert.match(body, /商品名、URL、店舗の画像URL、価格、メモ、優先度、個数、購入予定日、購入済み、カテゴリ、比較グループを、このアプリが動いている場所のSQLiteに保存します。/);
  assert.match(body, /価格の確認を実行すると、未購入の商品URLを取得します。価格が変わったときは履歴に残します。/);
  assert.match(body, /保存したSlackまたはDiscordのウェブフックがあり、通知がオンのときは、その宛先へ価格の通知を送ることがあります。/);
  assert.match(body, /会員がアップロードした画像は、位置情報などの付随データを落としてから保存します。/);
  assert.match(body, /写真から商品を判定するときは、写真をCloudflareのWorkers AI（api.cloudflare.com）へ送ります。写真そのものはこのアプリのデータベースに保存しません。/);
  assert.match(body, /検索で見つけた候補は30分で消します。/);
  assert.match(body, /Yahoo!ショッピング（shopping.yahooapis.jp）と楽天市場（openapi.rakuten.co.jp）/);
  assert.match(body, /キーが無い店は使いません。/);
  assert.match(body, /ゲスト体験は、その設定があるときだけ使えます。メールアドレスは受け取りません。期限の標準は24時間で、設定で変わります。/);
  assert.match(body, /期限が切れるか体験を終えると、ゲストのデータを消します。会員のログインには引き継ぎません。/);
  assert.match(body, /butuyokuoh_token/);
  assert.match(body, /httpOnly、SameSite=Lax、有効期限は7日です。本番ではSecureを付けます。/);
  assert.match(body, /butuyokuoh_guest/);
  assert.match(body, /サーバに残すのはトークンのハッシュです。/);
  assert.match(body, /Googleログインのあいだは、ログイン状態を保つ別のクッキーをブラウザに置きます。/);
  assert.match(body, /表示テーマはブラウザのlocalStorageに保存することがあります。サーバには送りません。/);
  assert.match(body, /会員は、ほしいもの、購入済み、または全部をCSVで書き出せます。/);
  assert.match(body, /設定の退会は、会員のアカウント、商品、価格履歴、カテゴリ、比較グループ、通知設定、アップロード画像、写真検索の記録と回数を消します。元に戻す操作はありません。/);
  assert.match(body, /画面に、広告配信やアクセス解析の外部タグは入れていません。/);
  assert.match(body, /下書きの日付は2026-10-23です。/);
  assert.match(page, /href="\/terms"/);
  for (const phrase of overclaim) assert.equal(body.includes(phrase), false, phrase);
});

test('利用規約は下書きで、アプリがしていること以上の法的な主張を書かない', () => {
  const page = html(createElement(TermsPage));
  const body = visible(createElement(TermsPage));
  assert.match(body, /利用規約（下書き）/);
  assert.match(body, /下書き。Sota の確認待ち。確定した利用規約ではありません。/);
  assert.match(body, /画面に同意の確認は無く、この文面への同意を利用の条件にしていません。/);
  assert.match(body, /ほしいものの一覧、価格、メモ、写真からの候補を、自分の画面に残すアプリです。/);
  assert.match(body, /会員はメールアドレスと6文字以上のパスワードで作ります。名前は任意です。/);
  assert.match(body, /ゲスト体験は、その設定があるときだけ使えます。期限が切れるか体験を終えるとデータを消し、会員のログインには引き継ぎません。/);
  assert.match(body, /会員がログアウトすると、それまでのログインは使えなくなります。/);
  assert.match(body, /設定の退会は、アカウントと登録したデータを消します。元に戻す操作はありません。/);
  assert.match(body, /商品URLを登録したり価格を取り直したりすると、そのURLのページを取得します。/);
  assert.match(body, /写真から探すと、写真を判定先へ送り、写真自体は保存しません。/);
  assert.match(body, /このアプリの中に、代金を払う機能はありません。/);
  assert.match(body, /会員は自分のデータをCSVで書き出せます。/);
  assert.match(body, /下書きの日付は2026-10-23です。/);
  assert.match(page, /href="\/privacy"/);
  for (const phrase of overclaim) assert.equal(body.includes(phrase), false, phrase);
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
  const { default: SettingsPage } = await import('../src/app/settings/page');
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
  const page = renderToStaticMarkup(createElement(AuthContext.Provider, { value }, createElement(SettingsPage)));
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /プライバシーポリシー（下書き）/);
  assert.match(page, /利用規約（下書き）/);
});
