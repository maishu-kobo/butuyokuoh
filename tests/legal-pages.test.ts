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
import {
  CONTACT_EMAIL,
  FOREIGN_PRIVACY_SYSTEMS_URL,
  LEGAL_EFFECTIVE_DATE,
  OPERATOR_NAME,
} from '../src/lib/legal';

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

const internalJargon = [
  'キーが無いとき',
  'アカウントIDとAPIトークン',
  '設定がある店',
  'その設定があるときだけ画面に出ます',
  'パスワードは6文字以上',
  '確認メールは送りません',
  'JWT',
  'httpOnly',
  'SameSite',
  'SQLite',
  'exe.dev',
  'api.cloudflare.com',
  'shopping.yahooapis.jp',
  'openapi.rakuten.co.jp',
  'ニューロン',
  'Auth.js',
  'NextAuth',
  'maishu-kobo/butuyokuoh',
  'GitHub',
];

test('運営者名・連絡先メールの定数が入っている', () => {
  assert.ok(OPERATOR_NAME.trim().length > 0, 'OPERATOR_NAME を src/lib/legal.ts に入れてください');
  assert.ok(CONTACT_EMAIL.trim().length > 0, 'CONTACT_EMAIL を src/lib/legal.ts に入れてください');
  assert.match(CONTACT_EMAIL, /@/, 'CONTACT_EMAIL はメールアドレス形式にしてください');
});

test('プライバシーポリシーは正式版で、利用者向けの粒度で書く', () => {
  const page = html(createElement(PrivacyPage));
  assert.match(page, /プライバシーポリシー/);
  assert.equal(page.includes('プライバシーポリシー（下書き）'), false);
  for (const phrase of draftMarks) assert.equal(page.includes(phrase), false, phrase);
  for (const phrase of internalJargon) assert.equal(page.includes(phrase), false, phrase);

  assert.match(page, /メールアドレスとパスワード/);
  assert.match(page, /照合用の値/);
  assert.match(page, /Googleアカウントでログインするとき/);
  assert.match(page, /ほしいものリストの内容/);
  assert.match(page, /位置情報/);
  assert.match(page, /写真から商品を推定するとき/);
  assert.match(page, /Cloudflare, Inc\./);
  assert.match(page, /Yahoo!ショッピングや楽天市場/);
  assert.match(page, /商品ページを取得します/);
  assert.match(page, /SlackまたはDiscord/);
  assert.match(page, /ホスティング事業者のサーバ/);
  assert.match(page, /アメリカ合衆国/);
  assert.match(page, /外国における個人情報の保護に関する制度等の調査/);
  assert.equal(page.includes(FOREIGN_PRIVACY_SYSTEMS_URL), true);
  assert.match(page, /プライバシーポリシーおよび/);
  assert.match(page, /butuyokuoh_token/);
  assert.match(page, /butuyokuoh_guest/);
  assert.match(page, /広告配信やアクセス解析のための外部タグは入れていません/);
  assert.match(page, new RegExp(`運営：${OPERATOR_NAME}`));
  assert.match(page, /運営者の氏名及び住所は、上記窓口へのご請求に応じて遅滞なくお知らせします/);
  assert.match(page, /開示等の請求、苦情の申出、お問い合わせ/);
  assert.match(page, new RegExp(`href="mailto:${CONTACT_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(page, new RegExp(`制定日・施行日：${LEGAL_EFFECTIVE_DATE}`));
  assert.match(page, /href="\/terms"/);
  assert.equal(page.includes('Gemini'), false);
  assert.equal(page.includes('GitHub'), false);
});

test('利用規約は正式版で、免責・変更・準拠法を書く', () => {
  const page = html(createElement(TermsPage));
  assert.match(page, /利用規約/);
  assert.equal(page.includes('利用規約（下書き）'), false);
  for (const phrase of draftMarks) assert.equal(page.includes(phrase), false, phrase);
  for (const phrase of internalJargon) assert.equal(page.includes(phrase), false, phrase);

  assert.match(page, /本サービスを利用した時点で、本規約に同意したものとみなします/);
  assert.match(page, /ほしいものの一覧、価格、メモ、写真からの候補/);
  assert.match(page, /未成年の方が本サービスを利用する場合/);
  assert.match(page, /Cloudflare, Inc\./);
  assert.match(page, /各ストアの表示が正しいものとします/);
  assert.match(page, /アフィリエイト用の識別子が付くことがあります/);
  assert.match(page, /Amazonのアソシエイトとして/);
  assert.match(page, /Supported by Rakuten Developers/);
  assert.match(page, /代金を払う機能はありません/);
  assert.match(page, /運営者の責めに帰すべき事由により利用者に損害が生じた場合、その損害を賠償します/);
  assert.match(page, /故意または重大な過失がある場合を除き/);
  assert.match(page, /現実に生じた通常かつ直接の損害に限られ/);
  assert.match(page, /逸失利益その他の特別な事情による損害は含みません/);
  assert.equal(page.includes('法令で許される範囲で責任を負いません'), false);
  assert.match(page, /法令で許される範囲で保証しません/);
  assert.match(page, /民法第548条の4/);
  assert.match(page, /準拠法/);
  assert.match(page, /本規約は日本法に準拠します/);
  assert.equal(page.includes('専属的合意管轄'), false);
  assert.equal(page.includes('東京地方裁判所'), false);
  assert.match(page, new RegExp(`href="mailto:${CONTACT_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(page, new RegExp(`制定日・施行日：${LEGAL_EFFECTIVE_DATE}`));
  assert.match(page, /href="\/privacy"/);
  assert.equal(page.includes('一切の責任を負いません'), false);
  assert.equal(page.includes('Gemini'), false);
  assert.equal(page.includes('GitHub'), false);
});

test('画面に運営者名と mailto の連絡先が出る', () => {
  const privacy = html(createElement(PrivacyPage));
  const terms = html(createElement(TermsPage));
  assert.equal(privacy.includes(OPERATOR_NAME), true);
  assert.equal(privacy.includes(CONTACT_EMAIL), true);
  assert.equal(privacy.includes(`mailto:${CONTACT_EMAIL}`), true);
  assert.equal(terms.includes(OPERATOR_NAME), true);
  assert.equal(terms.includes(CONTACT_EMAIL), true);
  assert.equal(terms.includes(`mailto:${CONTACT_EMAIL}`), true);
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
  assert.match(privacy, new RegExp(`制定日・施行日：${LEGAL_EFFECTIVE_DATE}`));
  assert.match(terms, new RegExp(`制定日・施行日：${LEGAL_EFFECTIVE_DATE}`));
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
