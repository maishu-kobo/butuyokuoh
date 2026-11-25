import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import type { ComparisonGroup, Item } from '../src/types';
import { buildReviewProducts, filterReviewItems, managedProducts } from '../src/lib/design-home';
import { focusedListSections } from '../src/lib/design-list-preview';
import { rankItem } from '../src/lib/design-rank';
import { wishlistRows } from '../src/lib/capture/list-card';

const query = { selectedCategory:null, selectedPriority:null, selectedGroup:null, searchQuery:'', sortBy:'priority' as const };
function item(id:number, priority:number, fields:Partial<Item>={}):Item {
  return { id, name:`商品${id}`, priority, sort_order:id, category_id:null, comparison_group_id:null,
    url:`manual://sort-${id}`, source:'other', source_name:'お店', current_price:1000, quantity:1,
    created_at:`2026-11-${String(id).padStart(2,'0')} 12:00:00`, planned_purchase_date:null,
    is_purchased:false, ...fields } as Item;
}

test('priority order groups highest first and retains the saved order inside each priority',()=>{
  const items=[item(1,4),item(2,2,{sort_order:8}),item(3,1),item(4,2,{sort_order:2})];
  const products=buildReviewProducts(items,[],[]);
  const ordered=managedProducts(products,items,'priority');
  assert.deepEqual(ordered.map(p=>p.active.id),[3,4,2,1]);
  const sections=focusedListSections(ordered,ordered,'priority');
  assert.deepEqual(sections.map(s=>[s.level,s.rows.map(r=>r.product.active.id)]),[[1,[3]],[2,[4,2]],[4,[1]]]);
  assert.deepEqual(items.map(i=>i.sort_order),[1,8,3,2]);
});

test('registration and purchase-date orders keep one photo product and use its budgeted date',()=>{
  const groups=[{id:9,name:'照明',origin:'photo'} as ComparisonGroup];
  const items=[item(1,2,{comparison_group_id:9,countsInTotal:false,planned_purchase_date:'2026-11-01'}),
    item(2,2,{comparison_group_id:9,countsInTotal:true,planned_purchase_date:'2027-02-01',created_at:'2026-11-10 12:00:00'}),
    item(3,1),item(4,4,{planned_purchase_date:'2027-01-01',created_at:'2026-11-15 12:00:00'})];
  const products=buildReviewProducts(items,groups,[]);
  assert.deepEqual(managedProducts(products,items,'date_new').map(p=>p.key),['item-4','group-9','item-3']);
  const planned=managedProducts(products,items,'planned_date');
  assert.deepEqual(planned.map(p=>p.key),['item-4','group-9','item-3']);
  assert.deepEqual(planned[1].offers.map(i=>i.id),[1,2]);
  assert.equal(planned[1].active.id,2);
  const purchased=item(8,2,{comparison_group_id:9,is_purchased:true,created_at:'2026-11-20 12:00:00'});
  for(const history of [[],[purchased]]) {
    const fullProducts=buildReviewProducts(items,groups,history);
    for(const sortBy of ['priority','date_new','planned_date'] as const) {
      const matching=filterReviewItems(items,groups,{...query,sortBy},history);
      const shelf=wishlistRows(matching,groups,history);
      assert.deepEqual(shelf.map(row=>row.kind==='item'?'item-'+row.item.id:'group-'+row.groupId),
        managedProducts(fullProducts,matching,sortBy).map(p=>p.key));
      assert.deepEqual(new Set(matching.map(i=>i.id)),new Set(items.map(i=>i.id)));
    }
  }
});

test('priority filters are a union, preserve all matching shop offers, and combine with search',()=>{
  const groups=[{id:9,name:'照明',origin:'photo'} as ComparisonGroup];
  const items=[item(1,2,{comparison_group_id:9,source_name:'駅前'}),item(2,4,{comparison_group_id:9}),item(3,1),item(4,4),item(5,3)];
  assert.deepEqual(filterReviewItems(items,groups,{...query,priorities:[1,2]}).map(i=>i.id).sort(),[1,2,3]);
  assert.deepEqual(filterReviewItems(items,groups,{...query,priorities:[4]}).map(i=>i.id),[4]);
  assert.equal(filterReviewItems(items,groups,{...query,priorities:[]}).length,5);
  assert.deepEqual(filterReviewItems(items,groups,{...query,priorities:[1,2],searchQuery:'駅前'}).map(i=>i.id),[1]);
  assert.deepEqual(filterReviewItems(items,groups,{...query,priorities:[1,2],selectedCategory:99}),[]);
});

test('sorting and multi-priority filtering preserve membership, stable same-priority order and inputs',()=>{
  fc.assert(fc.property(fc.array(fc.record({priority:fc.integer({min:1,max:5}),rank:fc.integer({min:0,max:30})}),{minLength:1,maxLength:20}),
    fc.subarray([1,2,3,4,5]),(rows,priorities)=>{
      const items=rows.map((r,index)=>item(index+1,r.priority,{sort_order:r.rank}));
      const before=structuredClone(items);
      const products=buildReviewProducts(items,[],[]);
      const matching=filterReviewItems(items,[],{...query,priorities});
      const ordered=managedProducts(products,matching,'priority');
      assert.deepEqual(new Set(ordered.map(p=>p.active.id)),new Set(items.filter(i=>!priorities.length||priorities.includes(i.priority)).map(i=>i.id)));
      for(let index=1;index<ordered.length;index++) {
        const a=rankItem(ordered[index-1]),b=rankItem(ordered[index]);
        assert.ok(a.priority<=b.priority);
        if(a.priority===b.priority) assert.ok(a.sort_order!<b.sort_order!||(a.sort_order===b.sort_order&&a.id<b.id));
      }
      assert.deepEqual(items,before);
    }),{seed:439,numRuns:150});
});
