import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeFailureCaption } from '../src/lib/scrape-failure-caption';

test('scrapeFailureCaption distinguishes bot limits from generic price refresh failures', () => {
  assert.equal(scrapeFailureCaption(null), '価格を更新できていません');
  assert.equal(scrapeFailureCaption('price not found'), '価格を更新できていません');
  assert.equal(
    scrapeFailureCaption('Amazonのボット対策により自動取得が制限されています。価格は手動で編集してください。'),
    '自動取得が制限されています',
  );
  assert.equal(scrapeFailureCaption('待機ページが返された', 'other'), '自動取得が制限されています');
  assert.equal(scrapeFailureCaption('何かのエラー', 'amazon'), '自動取得が制限されています');
  assert.equal(scrapeFailureCaption('何かのエラー', 'rakuten'), '自動取得が制限されています');
});
