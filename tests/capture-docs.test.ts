import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const REQUIRED = [
  'CAPTURE_ENABLED',
  'CAPTURE_AI_ENABLED',
  'CAPTURE_SECRETS_FILE',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'YAHOO_SHOPPING_APP_ID',
  'RAKUTEN_APP_ID',
  'RAKUTEN_ACCESS_KEY',
  'AMAZON_ASSOCIATE_TAG',
  '撮る',
  '写真を選ぶ',
  '15秒',
  '安い順',
  '30分',
  '手入力',
  '商品画像にしない',
  '確かさは数字にしない',
  '1秒に1回',
  '1分に5回',
  '1日に50回',
  '6秒',
  '5MB',
];

test('the capture guide explains usage, settings, key names, and limits', () => {
  const doc = readFileSync(new URL('../docs/capture.md', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../docs/README.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.equal(readme.includes('./capture.md'), true);
  for (const phrase of REQUIRED) {
    assert.equal(doc.includes(phrase), true, phrase);
  }
  assert.equal(changelog.includes('撮った写真は商品画像にしない'), true);
  assert.equal(changelog.includes('Yahoo!ショッピングと楽天市場'), true);
  assert.equal(/[0-9a-f]{32}/.test(doc), false);
});

test('the capture guide says the Rakuten daily price update ignores the capture flag and stops when the keys are removed', () => {
  const doc = readFileSync(new URL('../docs/capture.md', import.meta.url), 'utf8');
  assert.equal(doc.includes('scripts/check-prices.ts'), true);
  assert.equal(doc.includes('CAPTURE_ENABLED を見ない'), true);
  assert.equal(doc.includes('RAKUTEN_APP_ID と RAKUTEN_ACCESS_KEY が両方あるときだけ'), true);
  assert.equal(doc.includes('楽天のキーを外す'), true);
});
