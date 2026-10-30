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

const draftMarks = [
  '下書き',
  '確認待ち',
  'Sota',
  '確定したプライバシーポリシーではありません',
  '確定した利用規約ではありません',
  '確定した文面ではありません',
];

test('プライバシーポリシーは正式版で、実装どおりの扱いを書く', () => {
  const page = html(createElement(PrivacyPage));
  assert.match(page, /プライバシーポリシー/);
  assert.equal(page.includes('プライバシーポリシー（下書き）'), false);
  for (const phrase of draftMarks) assert.equal(page.includes(phrase), false, phrase);

  assert.match(page, /パスワードは6文字以上です/);
  assert.match(page, /照合用ハッシュ/);
  assert.match(page, /確認メールは送りません/);
  assert.match(page, /Googleログインを使うとき/);
  assert.match(page, /確認済みのGoogleアカウントのメールアドレス、名前、Googleの識別子を会員に結びつけます/);
  assert.match(page, /同じメールの会員に結ぶと、その会員のパスワードは消します/);
  assert.match(page, /商品名、URL、店舗の画像URL、価格、メモ、優先度、個数、購入予定日、購入済み、カテゴリ、比較グループ/);
  assert.match(page, /SQLiteに保存します/);
  assert.match(page, /その商品URLのページを取得します/);
  assert.match(page, /まとめて行う価格の確認は、会員の未購入で、ゴミ箱に無く、商品コードが無く、写真の比較グループに入っていない商品が対象です/);
  assert.match(page, /ショップが2件以上残っている商品は、個別のページ再取得の対象外とすることがあります/);
  assert.match(page, /SlackまたはDiscordのウェブフック/);
  assert.match(page, /位置情報などの付随データを落としてから/);
  assert.match(page, /写真から商品を探すときの推定結果/);
  assert.match(page, /CloudflareのWorkers AI（api\.cloudflare\.com/);
  assert.match(page, /キーが無いとき、または使えないときは、写真をそこへは送りません/);
  assert.match(page, /写真そのものはデータベースに保存しません/);
  assert.match(page, /各回のニューロン数/);
  assert.match(page, /検索で見つけた候補（店名・商品名・URL・店舗の商品画像・価格など）は30分で消します/);
  assert.match(page, /Yahoo!ショッピング（shopping\.yahooapis\.jp）と楽天市場（openapi\.rakuten\.co\.jp）/);
  assert.match(page, /キーが無い店は使いません/);
  assert.match(page, /Chrome拡張機能から送られる情報/);
  assert.match(page, /認証用トークン（JWT）/);
  assert.match(page, /ゲスト体験の情報/);
  assert.match(page, /メールアドレスは受け取りません/);
  assert.match(page, /期限の標準は24時間で、設定で変わります/);
  assert.match(page, /会員のログインには引き継ぎません/);
  assert.match(page, /butuyokuoh_token/);
  assert.match(page, /httpOnly、SameSite=Lax、有効期限は7日です。本番ではSecureを付けます/);
  assert.match(page, /butuyokuoh_guest/);
  assert.match(page, /サーバに残すのはトークンのハッシュです/);
  assert.match(page, /Googleログインのあいだは、ログイン状態を保つ別のクッキー/);
  assert.match(page, /表示テーマはブラウザのlocalStorageに保存することがあります。サーバには送りません/);
  assert.match(page, /CSVで書き出せます|会員のデータは、退会するまで/);
  assert.match(page, /写真判定の利用量の記録は、全体の日次上限の維持のため、会員との紐付けを外した匿名の行として残すことがあります/);
  assert.match(page, /他の会員が同じファイルを指しているときは、そのファイルを残すことがあります/);
  assert.match(page, /画面に、広告配信やアクセス解析のための外部タグは入れていません/);
  assert.match(page, /アメリカ合衆国/);
  assert.match(page, /exe\.dev/);
  assert.match(page, /maishu-kobo\/butuyokuoh/);
  assert.match(page, /制定日・施行日：2026年10月30日/);
  assert.match(page, /href="\/terms"/);
  assert.equal(page.includes('Gemini'), false);
  assert.equal(page.includes('generativelanguage.googleapis.com'), false);
});

test('利用規約は正式版で、免責と変更手続きを法令に沿って書く', () => {
  const page = html(createElement(TermsPage));
  assert.match(page, /利用規約/);
  assert.equal(page.includes('利用規約（下書き）'), false);
  for (const phrase of draftMarks) assert.equal(page.includes(phrase), false, phrase);

  assert.match(page, /本サービスを利用した時点で、本規約に同意したものとみなします/);
  assert.match(page, /ほしいものの一覧、価格、メモ、写真からの候補/);
  assert.match(page, /会員はメールアドレスと6文字以上のパスワードで作ります。名前は任意です/);
  assert.match(page, /ゲスト体験は、その設定があるときだけ使えます。期限が切れるか体験を終えるとデータを消し、会員のログインには引き継ぎません/);
  assert.match(page, /会員がログアウトすると、それまでのログインは使えなくなります/);
  assert.match(page, /設定の退会は、アカウントと登録したデータを消します。元に戻す操作はありません/);
  assert.match(page, /未成年の方が本サービスを利用する場合は、親権者その他の法定代理人の同意を得たうえでご利用ください/);
  assert.match(page, /商品URLを登録したり価格を取り直したりすると、そのURLのページを取得します/);
  assert.match(page, /CloudflareのWorkers AI（api\.cloudflare\.com）へ送ります/);
  assert.match(page, /キーが無いとき、または使えないときは、そこへは送りません/);
  assert.match(page, /写真自体はデータベースに保存しません/);
  assert.match(page, /各ストアの表示が正しいものとします/);
  assert.match(page, /アフィリエイト用の識別子が付くことがあります/);
  assert.match(page, /Amazonのアソシエイトとして/);
  assert.match(page, /Supported by Rakuten Developers/);
  assert.match(page, /このアプリの中に、代金を払う機能はありません|本サービスの中に、代金を払う機能はありません/);
  assert.match(page, /会員は自分のデータをCSVで書き出せます/);
  assert.match(page, /故意または重過失による場合を除き/);
  assert.match(page, /法令で許される範囲で/);
  assert.match(page, /民法第548条の4/);
  assert.match(page, /本規約は日本法に準拠します/);
  assert.match(page, /第一審の専属的合意管轄裁判所/);
  assert.match(page, /maishu-kobo\/butuyokuoh/);
  assert.match(page, /制定日・施行日：2026年10月30日/);
  assert.match(page, /href="\/privacy"/);
  assert.equal(page.includes('一切の責任を負いません'), false);
  assert.equal(page.includes('Gemini'), false);
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

test('直接開いた最初の描画でも正式な本文が出る', () => {
  const privacy = renderToStaticMarkup(createElement(RootProviders, null, createElement(PrivacyPage)));
  const terms = renderToStaticMarkup(createElement(RootProviders, null, createElement(TermsPage)));
  assert.match(privacy, /制定日・施行日：2026年10月30日/);
  assert.match(terms, /制定日・施行日：2026年10月30日/);
  assert.equal(privacy.includes('下書き'), false);
  assert.equal(terms.includes('下書き'), false);
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

test('ログイン画面から2つの方針ページを開ける', () => {
  const page = loginMarkup();
  assert.match(page, /href="\/privacy"/);
  assert.match(page, /href="\/terms"/);
  assert.match(page, /プライバシーポリシー/);
  assert.match(page, /利用規約/);
  assert.equal(page.includes('下書き'), false);
});

test('設定画面から2つの方針ページを開ける', async () => {
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
  assert.match(page, /プライバシーポリシー/);
  assert.match(page, /利用規約/);
  assert.match(page, /プライバシーと利用規約/);
  assert.equal(page.includes('下書き'), false);
  assert.equal(page.includes('Sota'), false);
});
