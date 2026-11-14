import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMember } from './regression-harness';
import { installProductFetchPort } from '../src/lib/product-fetch-port';
import { BOT_URL, FAIL_URL, regressionLookup } from '../src/lib/product-regression-fixtures';
import {
  PRODUCT_FETCH_BLOCKED_HELP_GUEST,
  PRODUCT_FETCH_HELP,
} from '../src/lib/public-page';
import { AMAZON_BOT_NOTE } from '../src/lib/scraper';

const AMAZON_SOFT_FAIL = 'https://www.amazon.co.jp/dp/B0SOFTFAIL1';

test('guest Amazon generic fetch failures stay generic and point to manual add, not bot-edit (#408 Bugbot)', async () => {
  const user = await createMember('guest-amazon-generic');
  installProductFetchPort({
    lookup: (candidate) => {
      if (candidate.href === AMAZON_SOFT_FAIL || candidate.pathname.includes('B0SOFTFAIL1')) {
        // fetchPublicPage が PRODUCT_FETCH_HELP にする典型: 非 HTML / 非 2xx
        return { status: 404, body: Buffer.from('not found'), contentType: 'text/plain' };
      }
      if (candidate.href === FAIL_URL || candidate.hostname === 'example.com') {
        return regressionLookup(candidate);
      }
      return regressionLookup(candidate);
    },
  });
  try {
    const { scrapeGuestUrl } = await import('../src/lib/guest-scraper');
    await assert.rejects(
      () => scrapeGuestUrl(AMAZON_SOFT_FAIL, user.id),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, PRODUCT_FETCH_HELP);
        assert.doesNotMatch(error.message, /ボット|編集/);
        assert.match(error.message, /手動で追加/);
        assert.notEqual(error.message, AMAZON_BOT_NOTE);
        return true;
      },
    );
  } finally {
    installProductFetchPort(null);
  }
});

test('guest Amazon bot HTML uses guest blocked copy with 手動で追加, not AMAZON_BOT_NOTE 編集 (#408 Bugbot)', async () => {
  const user = await createMember('guest-amazon-bot');
  installProductFetchPort({ lookup: regressionLookup });
  try {
    const { scrapeGuestUrl } = await import('../src/lib/guest-scraper');
    await assert.rejects(
      () => scrapeGuestUrl(BOT_URL, user.id),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, PRODUCT_FETCH_BLOCKED_HELP_GUEST);
        assert.match(error.message, /手動で追加/);
        assert.doesNotMatch(error.message, /「編集」/);
        assert.notEqual(error.message, AMAZON_BOT_NOTE);
        return true;
      },
    );
  } finally {
    installProductFetchPort(null);
  }
});
