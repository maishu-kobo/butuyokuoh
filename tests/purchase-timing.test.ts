import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { comparePurchaseTiming, parsePurchaseTiming, purchaseTiming, purchaseTimingLabel, purchaseTimingMonth } from '../src/lib/purchase-timing';
import { timingBudget } from '../src/lib/design-budget';
import { buildReviewProducts, managedProducts } from '../src/lib/design-home';
import type { Item } from '../src/types';

const item=(id:number,fields:Partial<Item>={})=>({id,name:'商品'+id,priority:3,sort_order:id,current_price:1000,quantity:1,
  created_at:'2026-11-26 12:00:00',comparison_group_id:null,category_id:null,planned_purchase_date:null,...fields} as Item);
test('existing date takes precedence over a month guide without modifying either saved value',()=>{
  const row=item(1,{planned_purchase_date:'2027-02-15',buy_guide:{month:'2026-12',timing:'by',condition:'値下がりしたら'}});
  const before=structuredClone(row);
  assert.deepEqual(purchaseTiming(row),{kind:'date',date:'2027-02-15'});
  assert.equal(purchaseTimingMonth(row),'2027-02');
  assert.equal(purchaseTimingLabel(purchaseTiming(row),2026),'2027年2月15日');
  assert.deepEqual(row,before);
  assert.equal(purchaseTimingLabel(purchaseTiming({...row,planned_purchase_date:null}),2026),'12月まで');
  assert.equal(purchaseTimingLabel({kind:'month',month:'2026-12',timing:'around'},2026),'12月ごろ');
});
test('invalid stored dates render safely and new timing input rejects impossible dates and months',()=>{
  for(const value of ['2027-02-29','2027-13-01','2027-04-31','bad']) {
    assert.equal(parsePurchaseTiming({kind:'date',date:value}),null);
    assert.deepEqual(purchaseTiming(item(1,{planned_purchase_date:value})),{kind:'undated'});
  }
  for(const value of [null,{}, {kind:'month',month:'2027-13',timing:'by'},{kind:'month',month:'2027-01',timing:'soon'},{kind:'date',date:''}]) assert.equal(parsePurchaseTiming(value),null);
  assert.deepEqual(parsePurchaseTiming({kind:'date',date:'2028-02-29'}),{kind:'date',date:'2028-02-29'});
});
test('month timing is ordered with actual dates, undated stays last, and direction never rewrites ranks',()=>{
  fc.assert(fc.property(fc.array(fc.record({month:fc.integer({min:1,max:12}),day:fc.integer({min:1,max:28}),kind:fc.constantFrom('date','month','undated')}),{minLength:2,maxLength:30}),entries=>{
    const rows=entries.map((x,i)=>item(i+1,x.kind==='date'?{planned_purchase_date:`2027-${String(x.month).padStart(2,'0')}-${String(x.day).padStart(2,'0')}`}:
      x.kind==='month'?{buy_guide:{month:`2027-${String(x.month).padStart(2,'0')}`,timing:'around',condition:''}}:{}));
    const before=structuredClone(rows);
    const products=buildReviewProducts(rows,[],[]);
    for(const direction of [1,-1] as const) {
      const ordered=managedProducts(products,rows,direction===1?'planned_date':'planned_date_desc').map(p=>p.active);
      let undated=false;
      ordered.forEach((row,i)=>{
        if(!purchaseTimingMonth(row)) undated=true; else assert.equal(undated,false);
        if(i) assert.ok(comparePurchaseTiming(ordered[i-1],row,direction)<=0);
      });
      assert.deepEqual(ordered.map(x=>x.id).sort((a,b)=>a-b),rows.map(x=>x.id));
    }
    assert.deepEqual(rows,before);
  }),{seed:443,numRuns:150});
  const rows=[item(1,{buy_guide:{month:'2027-01',timing:'by',condition:''}}),item(2,{planned_purchase_date:'2027-02-01'}),item(3)];
  assert.deepEqual(managedProducts(buildReviewProducts(rows,[],[]),rows,'planned_date').map(p=>p.active.id),[1,2,3]);
});
test('monthly budget includes approximate timing once and preserves all offers, prices and dates',()=>{
  const rows=[item(1,{buy_guide:{month:'2027-01',timing:'around',condition:''}}),
    item(2,{buy_guide:{month:'2027-02',timing:'by',condition:''},countsInTotal:false}),
    item(3,{planned_purchase_date:'2027-01-10',buy_guide:{month:'2027-03',timing:'by',condition:''},quantity:2}),item(4)];
  const before=structuredClone(rows);
  const budget=timingBudget(rows);
  assert.deepEqual(budget['2027-01'].items.map(x=>x.id),[1,3]);
  assert.equal(budget['2027-01'].total,3000);
  assert.equal(budget['2027-02'].total,0);
  assert.equal(budget.undated.total,1000);
  assert.equal(Object.values(budget).flatMap(x=>x.items).length,rows.length);
  assert.deepEqual(rows,before);
});
