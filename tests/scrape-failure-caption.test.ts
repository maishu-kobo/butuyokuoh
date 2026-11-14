import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeFailureCaption } from '../src/lib/scrape-failure-caption';
import {
  PRODUCT_FETCH_BLOCKED_HELP,
  PRODUCT_FETCH_BLOCKED_HELP_GUEST,
  PRODUCT_FETCH_HELP,
  scrapeFailedHelp,
} from '../src/lib/public-page';
import { AMAZON_BOT_NOTE } from '../src/lib/scraper';
import { amazonUsdFallbackNote } from '../src/lib/amazon-product';

test('scrapeFailureCaption distinguishes bot limits from generic price refresh failures', () => {
  assert.equal(scrapeFailureCaption(null), '価格を更新できていません');
  assert.equal(scrapeFailureCaption('price not found'), '価格を更新できていません');
  assert.equal(
    scrapeFailureCaption(AMAZON_BOT_NOTE),
    '販売サイト側で自動取得が制限されています',
  );
  assert.equal(
    scrapeFailureCaption('待機ページが返された', 'other'),
    '販売サイト側で自動取得が制限されています',
  );
  // 旧文言の残骸でもサイト側制限として扱う
  assert.equal(
    scrapeFailureCaption('自動取得が制限されています'),
    '販売サイト側で自動取得が制限されています',
  );
  assert.equal(
    scrapeFailureCaption(AMAZON_BOT_NOTE, 'amazon', { forGuest: true }),
    '販売サイト側の制限（ゲストは簡易取得）',
  );
  assert.equal(
    scrapeFailureCaption(PRODUCT_FETCH_BLOCKED_HELP_GUEST, 'other', { forGuest: true }),
    '販売サイト側の制限（ゲストは簡易取得）',
  );
});

test('scrapeFailureCaption does not treat Amazon/Rakuten source alone as a site block (#408 Bugbot)', () => {
  // USD フォールバックや一般的な価格欠落は「サイト側制限」にしない
  assert.equal(
    scrapeFailureCaption(amazonUsdFallbackNote(12.99), 'amazon'),
    '価格を更新できていません',
  );
  assert.equal(
    scrapeFailureCaption(amazonUsdFallbackNote(12.99), 'amazon', { forGuest: true }),
    '価格を更新できていません',
  );
  assert.equal(
    scrapeFailureCaption('価格は取得できませんでした。商品は保存できます。価格は「編集」から入力・変更できます。', 'amazon'),
    '価格を更新できていません',
  );
  assert.equal(
    scrapeFailureCaption('何かのエラー', 'amazon'),
    '価格を更新できていません',
  );
  assert.equal(
    scrapeFailureCaption('何かのエラー', 'rakuten', { forGuest: true }),
    '価格を更新できていません',
  );
  assert.equal(scrapeFailureCaption(null, 'amazon', { forGuest: true }), '価格を更新できていません');
  // 一般の PRODUCT_FETCH_HELP も source だけでは制限バッジにしない
  assert.equal(
    scrapeFailureCaption(PRODUCT_FETCH_HELP, 'amazon', { forGuest: true }),
    '価格を更新できていません',
  );
  assert.equal(
    scrapeFailureCaption(PRODUCT_FETCH_HELP, 'rakuten'),
    '価格を更新できていません',
  );
  // エラー文がブロックを示すときだけ制限バッジ（source は問わない）
  assert.equal(
    scrapeFailureCaption('取得を制限されている', 'other', { forGuest: true }),
    '販売サイト側の制限（ゲストは簡易取得）',
  );
});

test('blocked-help copy names the site (not guest mode) and points to manual add', () => {
  assert.match(PRODUCT_FETCH_BLOCKED_HELP, /販売サイト/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP, /ゲスト体験だけの制限ではありません/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP, /手動で追加/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP_GUEST, /ゲスト体験では/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP_GUEST, /ブラウザを使わない/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP_GUEST, /ログインすると/);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP_GUEST, /手動で追加/);
  assert.match(AMAZON_BOT_NOTE, /Amazon側/);
  assert.match(AMAZON_BOT_NOTE, /ゲスト体験に限った制限ではありません/);
  assert.match(AMAZON_BOT_NOTE, /編集/);
});

test('scrapeFailedHelp picks guest-specific blocked copy when asked', () => {
  assert.equal(
    scrapeFailedHelp({ failureCode: 'BOT_CHALLENGE' }),
    PRODUCT_FETCH_BLOCKED_HELP,
  );
  assert.equal(
    scrapeFailedHelp({ failureCode: 'BOT_CHALLENGE' }, { forGuest: true }),
    PRODUCT_FETCH_BLOCKED_HELP_GUEST,
  );
  // ゲストの追加失敗では「編集」案内の Amazon note を手動追加向けに差し替える
  assert.equal(
    scrapeFailedHelp({ failureCode: 'BOT_CHALLENGE', note: AMAZON_BOT_NOTE }, { forGuest: true }),
    PRODUCT_FETCH_BLOCKED_HELP_GUEST,
  );
  assert.equal(scrapeFailedHelp(null), PRODUCT_FETCH_HELP);
});
