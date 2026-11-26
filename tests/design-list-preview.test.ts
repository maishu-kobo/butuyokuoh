import assert from 'node:assert/strict';
import test from 'node:test';
import type { Item } from '../src/types';
import type { ReviewProduct } from '../src/lib/design-home';
import { focusedListSections, readListPreview } from '../src/lib/design-list-preview';
import { reviewHref } from '../src/lib/design-home';

const product=(id:number,priority:number):ReviewProduct=>({key:'item-'+id,offers:[{id,priority,is_purchased:false} as Item]} as ReviewProduct);
const ordered=[product(1,4),product(2,2),product(3,3),product(4,2)];

test('only priority sorting numbers the visible products within each priority',()=>{
  const all=focusedListSections(ordered,ordered,'date_new');
  assert.deepEqual(all.flatMap(section=>section.rows.map(row=>[row.product.key,row.rank])),[['item-1',null],['item-2',null],['item-3',null],['item-4',null]]);
  const high=focusedListSections(ordered,ordered.filter(p=>p.offers[0].priority===2),'priority');
  assert.deepEqual(high[0].rows.map(row=>row.rank),[1,2]);
  assert.deepEqual(high[0].entries.map(p=>p.key),['item-2','item-4']);
  assert.deepEqual(focusedListSections(ordered,[],'priority'),[]);
});

test('search numbers the visible rows without dropping the complete same-priority move scope',()=>{
  const sections=focusedListSections(ordered,[ordered[0],ordered[3]],'priority');
  assert.deepEqual(sections.map(section=>[section.level,section.rows.map(row=>row.rank)]),[[2,[1]],[4,[1]]]);
  assert.deepEqual(sections[0].entries.map(p=>p.key),['item-2','item-4']);
  assert.deepEqual(ordered.map(p=>p.key),['item-1','item-2','item-3','item-4']);
});

test('comparison links keep the selected layout and only accept the two local preview choices',()=>{
  assert.equal(readListPreview('focused'),'focused');
  assert.equal(readListPreview('current'),'current');
  for(const invalid of [null,undefined,'https://example.com','unknown']) assert.equal(readListPreview(invalid),undefined);
  assert.equal(reviewHref('rank','budget','paper','dark','focused'),'/design?tab=budget&palette=paper&appearance=dark&list=focused');
  assert.equal(reviewHref('rank',undefined,null,'light','current'),'/design?list=current');
  assert.equal(reviewHref('rank'),'/design');
});
