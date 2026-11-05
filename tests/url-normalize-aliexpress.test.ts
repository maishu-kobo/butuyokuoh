import './bugfix-harness';
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db } from './bugfix-harness';
import { sanitizeStoredItemUrl } from '../src/lib/item-input';
import { isBotChallengedHtml, PRODUCT_FETCH_BLOCKED_HELP, scrapeFailedHelp } from '../src/lib/public-page';
import { parseProductHtml } from '../src/lib/product-html';
import { isUnusableScrape } from '../src/lib/scraper';
import { installProductFetchPort } from '../src/lib/product-fetch-port';

const ALIEXPRESS_ITEM = 'https://ja.aliexpress.com/item/1005009497617522.html';
const punishHtml =
  '<script>sessionStorage.x5referer = window.location.href;' +
  'var url = "//ja.aliexpress.com//item/1005009497617522.html/_____tmd_____/punish?x5secdata=abc";</script>' +
  '<title>AliExpress</title>';

test('AliExpress PPC query is stripped to the item path (short fake params only)', () => {
  const dirty =
    'https://ja.aliexpress.com/item/1005009497617522.html' +
    '?osf=ppc_ug&guideModule=ppc_ug&src=google&albch=search&acnt=479-062-3723&isdl=y' +
    '&aff_short_key=UneMJZVf&albcp=23180586172&albag=184393879141&slnk=&trgt=kwl-1' +
    '&plac=&crea=780586392898&albad=780586392898&netw=g&device=m&mtctp=a&memo1=' +
    '&albbt=Google_7_search&aff_platform=google&albagn=888888&isSmbActive=false' +
    '&isSmbAutoCall=false&needSmbHouyi=false&gad_source=1&gad_campaignid=23180586172' +
    '&gbraid=0AAAAAD2chG4&gclid=CjwFakeParamOnly&gatewayAdapt=glo2jpn';
  assert.equal(
    sanitizeStoredItemUrl(dirty),
    'https://ja.aliexpress.com/item/1005009497617522.html',
  );
  assert.ok(dirty.length > 400);
  assert.ok((sanitizeStoredItemUrl(dirty) || '').length < 80);
});

test('bot challenge HTML is unusable and maps to the blocked help message', () => {
  assert.equal(isBotChallengedHtml(punishHtml), true);
  const scraped = parseProductHtml(punishHtml, ALIEXPRESS_ITEM);
  assert.equal(scraped.failureCode, 'BOT_CHALLENGE');
  assert.equal(scraped.name, '取得失敗');
  assert.equal(isUnusableScrape(scraped), true);
  assert.equal(scrapeFailedHelp(scraped), PRODUCT_FETCH_BLOCKED_HELP);
  assert.match(PRODUCT_FETCH_BLOCKED_HELP, /手動で追加/);
});

test('refresh keeps saved name/price/image when AliExpress returns a bot challenge', async () => {
  const owner = await createMember('aliexpress-refresh');
  const database = await db();
  const id = Number(
    database.prepare(`
      INSERT INTO items (user_id, name, url, current_price, image_url, source)
      VALUES (?, 'ロボット学習キット', ?, 3980, 'https://example.test/robot.jpg', 'other')
    `).run(owner.id, ALIEXPRESS_ITEM).lastInsertRowid,
  );

  installProductFetchPort({
    lookup: (candidate) => {
      // ホストは完全一致（不完全な部分一致は CodeQL の対象になる）
      if (candidate.hostname === 'ja.aliexpress.com') {
        return { status: 200, body: Buffer.from(punishHtml), contentType: 'text/html; charset=UTF-8' };
      }
      return undefined;
    },
  });
  try {
    const response = await call(
      '../src/app/api/items/[id]/refresh/route.ts',
      'POST',
      `/api/items/${id}/refresh`,
      {},
      { id: String(id) },
    );
    assert.equal(response.status, 200, response.text);
    const row = response.json as {
      name: string;
      current_price: number;
      image_url: string;
      scrape_status: string;
      scrape_error: string | null;
    };
    assert.equal(row.name, 'ロボット学習キット');
    assert.equal(row.current_price, 3980);
    assert.equal(row.image_url, 'https://example.test/robot.jpg');
    assert.equal(row.scrape_status, 'failed');
    assert.match(String(row.scrape_error || ''), /手動で追加|制限/);
    assert.equal(
      (database.prepare('SELECT COUNT(*) AS n FROM price_history WHERE item_id = ?').get(id) as { n: number }).n,
      0,
    );
  } finally {
    installProductFetchPort(null);
  }
});
