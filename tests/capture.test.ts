import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAPTURE_PHOTO_MAX_BYTES,
  CaptureMessages,
  amazonSearchUrl,
  decodeCapturePhoto,
  isValidJan,
  parseRegisterRequest,
  parseSearchQuery,
  sortCandidates,
  type CaptureCandidate,
  type CapturePorts,
  type SearchQuery,
} from '../src/lib/capture/contract';
import { createFakePorts, searchWithPorts } from '../src/lib/capture/fakes';
import { getCapturePorts, resetCapturePorts, setCapturePorts } from '../src/lib/capture/ports';

const NOW = '2026-10-22T00:00:00.000Z';
const now = () => new Date(NOW);
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const webp = Uint8Array.of(...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'));
const heic = Uint8Array.of(0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0);
const query: SearchQuery = {
  name: 'テスト用ゲルボールペン 0.5',
  brand: '物欲文具',
  model: 'BY-05',
  jan: '4900000000009',
};

function candidate(overrides: Partial<CaptureCandidate> = {}): CaptureCandidate {
  return {
    id: 'yahoo:1',
    site: 'yahoo',
    title: 'テスト用ゲルボールペン 0.5',
    price: 980,
    url: 'https://store.shopping.yahoo.co.jp/example/pen',
    fetchedAt: NOW,
    shopName: 'テストショップ',
    ...overrides,
  };
}

test('JAN is accepted only for 8 or 13 digits with a valid check digit', () => {
  assert.equal(isValidJan('4900000000009'), true);
  assert.equal(isValidJan('12345670'), true);
  assert.equal(isValidJan('4900000000008'), false);
  assert.equal(isValidJan('12345671'), false);
  assert.equal(isValidJan('490000000000'), false);
  assert.equal(isValidJan('49000000000091'), false);
  assert.equal(isValidJan('490000000000a'), false);
  assert.equal(isValidJan(' 4900000000009'), false);
});

test('search query keeps a valid JAN and drops an invalid one', () => {
  const parsed = parseSearchQuery({ name: ' ペン ', brand: '物欲文具', model: 'BY-05', jan: '4900000000009' });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, { name: 'ペン', brand: '物欲文具', model: 'BY-05', jan: '4900000000009' });

  const dropped = parseSearchQuery({ name: 'ペン', jan: '4900000000008' });
  assert.equal(dropped.ok, true);
  if (!dropped.ok) return;
  assert.equal(dropped.value.jan, null);

  const janOnly = parseSearchQuery({ jan: '12345670' });
  assert.equal(janOnly.ok, true);
  if (!janOnly.ok) return;
  assert.equal(janOnly.value.name, '');
  assert.equal(janOnly.value.jan, '12345670');

  for (const input of [null, [], { name: '' }, { name: '   ' }, { name: 1 }, { jan: 4900000000009 }, { name: 'ペン', brand: 1 }]) {
    const result = parseSearchQuery(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.equal(result.error.code, 'INVALID_INPUT');
  }
  const long = parseSearchQuery({ name: 'あ'.repeat(201) });
  assert.equal(long.ok, false);
});

test('register request accepts only candidate ids', () => {
  const parsed = parseRegisterRequest({ candidateIds: ['yahoo:abc-1', 'rakuten:2'] });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value.candidateIds, ['yahoo:abc-1', 'rakuten:2']);
  for (const input of [
    {},
    { candidateIds: [] },
    { candidateIds: ['yahoo:abc-1', 'yahoo:abc-1'] },
    { candidateIds: ['amazon:1'] },
    { candidateIds: [1] },
    { candidateIds: ['yahoo:../x'] },
  ]) {
    const result = parseRegisterRequest(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) {
      assert.equal(result.error.code, 'INVALID_INPUT');
      assert.equal(result.error.error, CaptureMessages.registerInput);
    }
  }
});

test('Amazon search link stays on www.amazon.co.jp and prefers a valid JAN', () => {
  const withJan = new URL(amazonSearchUrl(query, 'test-tag-22'));
  assert.equal(withJan.protocol, 'https:');
  assert.equal(withJan.hostname, 'www.amazon.co.jp');
  assert.equal(withJan.pathname, '/s');
  assert.equal(withJan.searchParams.get('k'), query.jan);
  assert.equal(withJan.searchParams.get('tag'), 'test-tag-22');

  const byName = new URL(amazonSearchUrl({ name: 'ペン A&B', jan: '4900000000008' }, 'bad tag'));
  assert.equal(byName.hostname, 'www.amazon.co.jp');
  assert.equal(byName.searchParams.get('k'), 'ペン A&B');
  assert.equal(byName.searchParams.get('tag'), null);

  const untagged = new URL(amazonSearchUrl({ name: 'ペン', jan: null }, '  '));
  assert.equal(untagged.searchParams.get('tag'), null);
});

test('photo bytes accept jpeg png and webp, and reject HEIC, a second file, and oversize input', () => {
  for (const [bytes, mediaType] of [
    [jpeg, 'image/jpeg'],
    [png, 'image/png'],
    [webp, 'image/webp'],
    [jpeg, ''],
    [png, 'image/jpeg'],
  ] as const) {
    const result = decodeCapturePhoto([{ mediaType, bytes }]);
    assert.equal(result.ok, true, mediaType);
  }

  const heicResult = decodeCapturePhoto([{ mediaType: 'image/heic', bytes: heic }]);
  assert.equal(heicResult.ok, false);
  if (!heicResult.ok) {
    assert.equal(heicResult.error.code, 'UNSUPPORTED_MEDIA');
    assert.equal(heicResult.error.error, CaptureMessages.photoUnreadable);
  }
  const sniffedHeic = decodeCapturePhoto([{ mediaType: 'image/jpeg', bytes: heic }]);
  assert.equal(sniffedHeic.ok, false);
  if (!sniffedHeic.ok) assert.equal(sniffedHeic.error.error, CaptureMessages.photoUnreadable);

  const two = decodeCapturePhoto([
    { mediaType: 'image/jpeg', bytes: jpeg },
    { mediaType: 'image/png', bytes: png },
  ]);
  assert.equal(two.ok, false);
  if (!two.ok) {
    assert.equal(two.error.code, 'INVALID_INPUT');
    assert.equal(two.error.error, CaptureMessages.onePhoto);
  }

  const huge = new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1);
  huge.set(jpeg);
  const tooBig = decodeCapturePhoto([{ mediaType: 'image/jpeg', bytes: huge }]);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) {
    assert.equal(tooBig.error.code, 'PHOTO_TOO_LARGE');
    assert.equal(tooBig.status, 413);
  }

  const garbage = decodeCapturePhoto([{ mediaType: 'image/jpeg', bytes: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12) }]);
  assert.equal(garbage.ok, false);
  if (!garbage.ok) assert.equal(garbage.error.code, 'PHOTO_UNREADABLE');
});

test('fake identifier returns a fixed product and does not call the network', async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    throw new Error('network disabled');
  }) as typeof fetch;
  try {
    const sure = await createFakePorts('default', now).identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
    assert.equal(sure.ok, true);
    if (sure.ok) {
      assert.equal(sure.value.confidence, 'sure');
      assert.equal(sure.value.products.length, 1);
      assert.deepEqual(sure.value.products[0], {
        name: query.name,
        brand: query.brand,
        model: query.model,
        jan: query.jan,
      });
      assert.equal('score' in sure.value, false);
    }

    const unsure = await createFakePorts('unsure', now).identifier.identify({ mediaType: 'image/png', bytes: png });
    assert.equal(unsure.ok, true);
    if (unsure.ok) {
      assert.equal(unsure.value.confidence, 'unsure');
      assert.equal(unsure.value.products.length, 3);
    }

    const unreadable = await createFakePorts('unreadable', now).identifier.identify({ mediaType: 'image/webp', bytes: webp });
    assert.equal(unreadable.ok, true);
    if (unreadable.ok) {
      assert.equal(unreadable.value.confidence, 'unreadable');
      assert.deepEqual(unreadable.value.products, []);
    }

    const rejected = await createFakePorts('default', now).identifier.identify({ mediaType: 'image/heic', bytes: heic });
    assert.equal(rejected.ok, false);

    for (const [scenario, code] of [
      ['ai-timeout', 'AI_TIMEOUT'],
      ['ai-unavailable', 'AI_UNAVAILABLE'],
      ['ai-invalid', 'AI_INVALID_RESPONSE'],
    ] as const) {
      const result = await createFakePorts(scenario, now).identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg });
      assert.equal(result.ok, false, scenario);
      if (!result.ok) assert.equal(result.error.code, code);
    }
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('fake Yahoo and Rakuten searches return candidates without keys or network', async () => {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push('fetch');
    throw new Error('network disabled');
  }) as typeof fetch;
  const keys = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'YAHOO_CLIENT_ID', 'RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) delete process.env[key];
  try {
    const ports = createFakePorts('default', now);
    const yahoo = await ports.yahoo.search(query);
    const rakuten = await ports.rakuten.search(query);
    assert.equal(yahoo.ok && rakuten.ok, true);
    if (!yahoo.ok || !rakuten.ok) return;
    assert.equal(yahoo.value.length, 1);
    assert.equal(rakuten.value.length, 1);
    const [yahooItem, rakutenItem] = [yahoo.value[0], rakuten.value[0]];
    assert.equal(yahooItem.site, 'yahoo');
    assert.equal(rakutenItem.site, 'rakuten');
    assert.equal(yahooItem.price, 980);
    assert.equal(rakutenItem.price, 1200);
    assert.equal(yahooItem.fetchedAt, NOW);
    assert.equal(rakutenItem.fetchedAt, NOW);
    assert.equal(yahooItem.jan, query.jan);
    assert.equal(rakutenItem.jan, query.jan);
    assert.equal(new URL(yahooItem.url).hostname, 'store.shopping.yahoo.co.jp');
    assert.equal(new URL(rakutenItem.url).hostname, 'item.rakuten.co.jp');
    assert.equal(yahooItem.title.includes(query.name), true);
    assert.deepEqual(calls, []);

    const found = await searchWithPorts(query, ports, null);
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.value.failures.length, 0);
    assert.deepEqual(found.value.candidates.map(item => item.site), ['yahoo', 'rakuten']);
    assert.equal(new URL(found.value.amazonUrl).searchParams.get('k'), query.jan);
    for (const item of found.value.candidates) {
      assert.equal(typeof item.title, 'string');
      assert.equal(typeof item.price, 'number');
      assert.equal(typeof item.url, 'string');
      assert.equal(typeof item.fetchedAt, 'string');
    }

    const noJan = await searchWithPorts({ name: 'ペン', brand: null, model: null, jan: null }, createFakePorts('default', now), null);
    assert.equal(noJan.ok, true);
    if (noJan.ok) {
      assert.equal(noJan.value.candidates.every(item => !('jan' in item)), true);
      assert.equal(new URL(noJan.value.amazonUrl).searchParams.get('k'), 'ペン');
    }
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('a failed site does not hide the other site, and two failures are not an empty success', async () => {
  const yahooDown = await searchWithPorts(query, createFakePorts('yahoo-down', now), null);
  assert.equal(yahooDown.ok, true);
  if (yahooDown.ok) {
    assert.deepEqual(yahooDown.value.candidates.map(item => item.site), ['rakuten']);
    assert.deepEqual(yahooDown.value.failures.map(failure => failure.site), ['yahoo']);
    assert.equal(yahooDown.value.failures[0].code, 'SEARCH_FAILED');
  }

  const rakutenDown = await searchWithPorts(query, createFakePorts('rakuten-down', now), null);
  assert.equal(rakutenDown.ok, true);
  if (rakutenDown.ok) {
    assert.deepEqual(rakutenDown.value.candidates.map(item => item.site), ['yahoo']);
    assert.equal(rakutenDown.value.failures[0].site, 'rakuten');
    assert.equal(rakutenDown.value.failures[0].code, 'SEARCH_TIMEOUT');
  }

  const both = await searchWithPorts(query, createFakePorts('both-down', now), null);
  assert.equal(both.ok, false);
  if (!both.ok) {
    assert.equal(both.error.code, 'SEARCH_FAILED');
    assert.equal(both.error.error, CaptureMessages.searchFailed);
    assert.deepEqual(both.error.failures?.map(failure => failure.site), ['yahoo', 'rakuten']);
    assert.equal(JSON.stringify(both).includes('store.shopping.yahoo.co.jp'), false);
  }

  const empty = await searchWithPorts(query, createFakePorts('empty', now), null);
  assert.equal(empty.ok, true);
  if (empty.ok) {
    assert.deepEqual(empty.value.candidates, []);
    assert.deepEqual(empty.value.failures, []);
    assert.equal(new URL(empty.value.amazonUrl).hostname, 'www.amazon.co.jp');
  }
});

test('search drops candidates whose URL is not an allowed https host', async () => {
  const evil = 'https://user:secret@evil.example/item';
  const ports: CapturePorts = {
    identifier: createFakePorts('default', now).identifier,
    yahoo: { async search() { return { ok: true, value: [candidate({ url: evil, jan: query.jan ?? undefined })] }; } },
    rakuten: { async search() { return { ok: true, value: [candidate({ id: 'rakuten:1', site: 'rakuten', url: 'https://item.rakuten.co.jp/example/pen', price: 1200 })] }; } },
  };
  const result = await searchWithPorts(query, ports, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.candidates.map(item => item.site), ['rakuten']);
  assert.equal(JSON.stringify(result.value).includes('evil.example'), false);
  assert.equal(result.value.failures[0].site, 'yahoo');
});

test('candidates sort by JAN match, then name, then price', () => {
  const sorted = sortCandidates([
    candidate({ id: 'rakuten:z', site: 'rakuten', title: '別の商品', price: 100, url: 'https://item.rakuten.co.jp/example/other' }),
    candidate({ id: 'yahoo:jan', title: '別の商品', price: 2000, jan: query.jan ?? undefined }),
    candidate({ id: 'rakuten:name-high', site: 'rakuten', title: 'テスト用ゲルボールペン 0.5 大', price: 500, url: 'https://item.rakuten.co.jp/example/high' }),
    candidate({ id: 'yahoo:name-low', title: 'テスト用ゲルボールペン 0.5 小', price: 400 }),
  ], query);
  assert.deepEqual(sorted.map(item => item.id), ['yahoo:jan', 'yahoo:name-low', 'rakuten:name-high', 'rakuten:z']);
});

test('capture ports can be replaced and restored without a network client', async () => {
  const custom = createFakePorts('empty', now);
  setCapturePorts(custom);
  try {
    assert.equal(getCapturePorts(), custom);
    const result = await searchWithPorts(query, getCapturePorts(), null);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.candidates.length, 0);
  } finally {
    resetCapturePorts();
  }
  const restored = await searchWithPorts(query, getCapturePorts(), null);
  assert.equal(restored.ok, true);
  if (restored.ok) assert.equal(restored.value.candidates.length, 2);
});

test('fake capture sources do not read credentials or open the network', () => {
  const source = readFileSync(new URL('../src/lib/capture/fakes.ts', import.meta.url), 'utf8');
  assert.equal(/fetch\s*\(/.test(source), false);
  assert.equal(/https?\.request/.test(source), false);
  assert.equal(/process\.env/.test(source), false);
  assert.equal(/api[_-]?key/i.test(source), false);
});
