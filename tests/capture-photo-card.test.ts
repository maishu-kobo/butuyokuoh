import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatListTimestamp, photoFaceItemId, photoImageUrl, shopBadgeText } from '../src/lib/capture/photo-card-view';

test('a shop badge is the store name once, and the site name when the store repeats it', () => {
  assert.equal(shopBadgeText('Yahoo!ショッピング', 'Yahoo!ショッピング'), 'Yahoo!ショッピング');
  assert.equal(shopBadgeText('楽天', '楽天'), '楽天');
  assert.equal(shopBadgeText('Yahoo!ショッピング', 'テストショップ'), 'テストショップ');
  assert.equal(shopBadgeText('Yahoo!ショッピング', 'Yahoo!ショッピング').split('Yahoo!ショッピング').length, 2);
});

test('list timestamps are Japanese local time, and an unreadable value is blank', () => {
  assert.equal(formatListTimestamp('2026-10-23T00:33:53.164Z'), '2026/10/23 09:33');
  assert.equal(formatListTimestamp('2026-10-22 01:02:03'), '2026/10/22 10:02');
  assert.equal(formatListTimestamp('not-a-date'), '');
  assert.equal(formatListTimestamp(null), '');
  assert.equal(formatListTimestamp('  '), '');
});

test('a photo card image is an https provider host, and anything else is dropped', () => {
  assert.equal(
    photoImageUrl('yahoo', 'https://item-shopping.c.yimg.jp/i/g/belkin'),
    'https://item-shopping.c.yimg.jp/i/g/belkin',
  );
  assert.equal(
    photoImageUrl('yahoo', 'https://item-shopping.c.yimg.jp/i/g/belkin?w=76#top'),
    'https://item-shopping.c.yimg.jp/i/g/belkin?w=76',
  );
  assert.equal(photoImageUrl('yahoo', 'http://item-shopping.c.yimg.jp/i/g/belkin'), null);
  assert.equal(photoImageUrl('yahoo', 'https://evil.example/a.jpg'), null);
  assert.equal(photoImageUrl('yahoo', 'https://store.shopping.yahoo.co.jp/shop/milk.jpg'), null);
  assert.equal(photoImageUrl('yahoo', 'https://user:pass@item-shopping.c.yimg.jp/i/g/belkin'), null);
  assert.equal(
    photoImageUrl('rakuten', 'https://thumbnail.image.rakuten.co.jp/@0_mall/ex/cabinet/a.jpg'),
    'https://thumbnail.image.rakuten.co.jp/@0_mall/ex/cabinet/a.jpg',
  );
  assert.equal(
    photoImageUrl('rakuten', 'https://tshop.r10s.jp/ex/cabinet/a.jpg?_ex=128x128'),
    'https://tshop.r10s.jp/ex/cabinet/a.jpg?_ex=128x128',
  );
  assert.equal(photoImageUrl('amazon', 'https://m.media-amazon.com/images/I/demo.jpg'), null);
  assert.equal(photoImageUrl('yahoo', null), null);
});

test('the card face is the cheapest shop that is not purchased', () => {
  assert.equal(photoFaceItemId({
    shops: [
      { itemId: 12, purchased: true },
      { itemId: 10, purchased: false },
      { itemId: 11, purchased: false },
    ],
  }), 10);
  assert.equal(photoFaceItemId({
    shops: [{ itemId: 4, purchased: false }],
  }), 4);
});
