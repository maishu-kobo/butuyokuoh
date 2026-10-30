/** Offline comparison; regression-harness forces a new temporary SQLite DB. No EC/API traffic. */
import '../tests/regression-harness';
import { performance } from 'node:perf_hooks';
import { call, createMember, db } from '../tests/regression-harness';

async function main() {
  const database = await db();
  const results = [];
  for (const count of [500, 1000]) {
    const owner = await createMember('pagination-benchmark-' + count);
    const insert = database.prepare(`INSERT INTO items
      (user_id, name, url, image_url, current_price, priority, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-01 00:00:00', '2026-10-01 00:00:00')`);
    const history = database.prepare('INSERT INTO price_history (item_id, price, recorded_at) VALUES (?, ?, ?)');
    database.transaction(() => {
      for (let i = 0; i < count; i++) {
        const id = Number(insert.run(owner.id, 'テスト商品' + String(i).padStart(4, '0'),
          'https://example.test/item/' + i, 'https://example.test/image/' + 'x'.repeat(500) + i,
          1000 + i, i % 5 + 1, i).lastInsertRowid);
        for (let day = 1; day <= 10; day++) history.run(id, 1000 + i + day,
          '2026-09-' + String(day).padStart(2, '0') + ' 00:00:00');
      }
    })();
    const cases = [
      { label: 'legacy-all', module: '../src/app/api/items/route.ts', path: '/api/items' },
      { label: 'first-page-50', module: '../src/app/api/items/page/route.ts', path: '/api/items/page?limit=50' },
    ];
    // Warm both modules/SQLite; alternate timing order to avoid a fixed-order bias.
    for (const entry of cases) await call(entry.module, 'GET', entry.path);
    const samples: Record<string, number[]> = {};
    const bytes: Record<string, number> = {};
    for (let sample = 0; sample < 20; sample++) {
      for (const entry of sample % 2 ? [...cases].reverse() : cases) {
        const start = performance.now();
        const result = await call(entry.module, 'GET', entry.path);
        if (result.status !== 200) throw new Error(entry.label + ': ' + result.status);
        (samples[entry.label] ??= []).push(performance.now() - start);
        bytes[entry.label] = result.bytes.length;
      }
    }
    let cursor: string | null = null;
    let fullBytes = 0; let requests = 0; const ids = new Set<number>();
    const allStart = performance.now();
    do {
      const result = await call(cases[1].module, 'GET', cases[1].path + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (result.status !== 200) throw new Error('full walk: ' + result.status);
      const page = result.json as { items: { id: number }[]; nextCursor: string | null };
      for (const item of page.items) {
        if (ids.has(item.id)) throw new Error('duplicate item');
        ids.add(item.id);
      }
      fullBytes += result.bytes.length; requests++; cursor = page.nextCursor;
    } while (cursor);
    if (ids.size !== count) throw new Error('missing item');
    results.push({ count, historyRows: count * 10, samples: 20,
      cases: cases.map(entry => {
        const sorted = samples[entry.label].sort((a, b) => a - b);
        return { label: entry.label, bytes: bytes[entry.label], medianMs: Number(((sorted[9] + sorted[10]) / 2).toFixed(3)),
          minMs: Number(sorted[0].toFixed(3)), maxMs: Number(sorted[19].toFixed(3)) };
      }), fullWalk: { requests, distinctItems: ids.size, bytes: fullBytes, elapsedMs: Number((performance.now() - allStart).toFixed(3)) },
    });
  }
  console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch,
    method: 'In-process route calls, warm SQLite, uncompressed response UTF-8 bytes; no browser/network latency', results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
