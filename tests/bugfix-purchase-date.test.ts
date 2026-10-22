import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localCalendarDate } from '../src/lib/local-date';

test('a purchase date is the local calendar day, including Japan just after midnight', () => {
  const justAfterMidnightInJapan = new Date('2026-10-21T15:30:00.000Z');
  assert.equal(justAfterMidnightInJapan.toISOString().slice(0, 10), '2026-10-21');
  assert.equal(localCalendarDate(justAfterMidnightInJapan, 'Asia/Tokyo'), '2026-10-22');
  assert.equal(localCalendarDate(new Date(2026, 9, 22, 0, 30)), '2026-10-22');

  for (const file of ['src/app/page.tsx', 'src/components/ItemCard.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /localCalendarDate\(/);
    assert.equal(source.includes("toISOString().split('T')[0]"), false, file);
  }
});
