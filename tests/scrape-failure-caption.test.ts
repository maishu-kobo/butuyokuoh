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
  assert.equal(
    scrapeFailureCaption('何かのエラー', 'amazon'),
    '販売サイト側で自動取得が制限されています',
  );
  assert.equal(
    scrapeFailureCaption('何かのエラー', 'rakuten'),
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
  assert.equal(
    scrapeFailedHelp({ failureCode: 'BOT_CHALLENGE', note: AMAZON_BOT_NOTE }, { forGuest: true }),
    AMAZON_BOT_NOTE,
  );
  assert.equal(scrapeFailedHelp(null), PRODUCT_FETCH_HELP);
});
