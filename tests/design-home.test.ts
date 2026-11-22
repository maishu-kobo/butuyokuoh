import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComparisonGroup, Item } from '../src/types';
import { buildReviewProducts, groupByPlannedMonth, newestFirst, readReviewView, reviewHref } from '../src/lib/design-home';

function item(id: number, fields: Partial<Item> = {}): Item {
  return {
    id, name: '商品' + id, url: 'manual://test', source: 'other', source_name: '販売店',
    image_url: null, current_price: 1000, quantity: 1, comparison_group_id: null,
    planned_purchase_date: null, is_purchased: false, created_at: '2026-11-01 12:00:00',
    ...fields,
  } as Item;
}
const group = { id: 7, name: 'スニーカー', origin: 'photo' } as ComparisonGroup;

test('uses the actually budgeted offer for its date and amount in both layouts', () => {
  const first = item(1, { comparison_group_id: 7, current_price: 4500, countsInTotal: false, planned_purchase_date: '2026-11-25' });
  const second = item(2, { comparison_group_id: 7, current_price: 4800, quantity: 2, countsInTotal: true, planned_purchase_date: '2026-12-01' });
  const unknown = item(3, { current_price: null, planned_purchase_date: '2026-12-04' });
  const later = item(4, { created_at: '2026-11-16 12:00:00' });
  const products = buildReviewProducts([first, second, unknown, later], [group], []);
  assert.equal(products.length, 3);
  assert.equal(products[0].active.id, 2);
  assert.deepEqual(products[0].offers.map(({id}) => id), [1, 2]);
  const months = groupByPlannedMonth(products);
  assert.deepEqual(months.map(m => [m.month, m.total, m.unknownCount]), [['2026-12',9600,1],['',1000,0]]);
  assert.equal(newestFirst(products)[0].active.id, 4);
});

test('keeps purchased alternatives visible and respects their exclusion from future spending', () => {
  const open = item(1, { comparison_group_id: 7, countsInTotal: false, planned_purchase_date: '2026-11-16' });
  const purchased = item(2, { comparison_group_id: 7, is_purchased: true, countsInTotal: true });
  const products = buildReviewProducts([open], [group], [purchased]);
  assert.equal(products.length, 1);
  assert.equal(products[0].active.id, 1);
  assert.equal(products[0].offers.length, 2);
  assert.equal(groupByPlannedMonth(products)[0].total, 0);
});

test('returns to the same review mode and never uses a free-form return URL', () => {
  for (const stale of [undefined, 'photo', 'compare', 'unknown']) assert.equal(readReviewView(stale), 'rank');
  assert.equal(reviewHref('rank'), '/design');
  assert.equal(reviewHref('rank', 'budget'), '/design?tab=budget');
  assert.equal(reviewHref('plan', 'budget'), '/design?view=plan&tab=budget');
  assert.equal(reviewHref('plan'), '/design?view=plan');
  assert.equal(reviewHref('plan','budget','indigo','dark'), '/design?view=plan&tab=budget&palette=indigo&appearance=dark');
  assert.equal(reviewHref('rank',undefined,'sage','light'), '/design?palette=sage');
  assert.equal(reviewHref('rank',undefined,null,'dark'), '/design');
});
