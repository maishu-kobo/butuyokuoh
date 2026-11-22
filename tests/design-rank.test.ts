import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/lib/db';
import { attachBuyGuides, moveProduct, saveBuyGuide } from '../src/lib/item-ranking';
import { monthCaption, parseRankAction } from '../src/lib/design-rank';

function fixture() {
  const db = openDatabase(':memory:');
  const user = db.prepare('INSERT INTO users(id,email,name,password_hash) VALUES(?,?,?,?)');
  user.run(1,'one@example.invalid','one','test');
  user.run(2,'two@example.invalid','two','test');
  db.prepare("INSERT INTO comparison_groups(id,user_id,name,priority,origin) VALUES(7,1,'靴',2,'photo')").run();
  const add = db.prepare(`INSERT INTO items(id,user_id,name,url,priority,sort_order,comparison_group_id,notes,planned_purchase_date)
    VALUES(?,?,?, ?,?,?,?, ?,?)`);
  add.run(1,1,'靴 A','manual://1',2,0,7,'店 A のメモ','2027-01-07');
  add.run(2,1,'靴 B','manual://2',2,1,7,'店 B のメモ','2027-01-07');
  add.run(3,1,'低い候補','manual://3',4,10,null,'メモ\nそのまま',null);
  add.run(4,1,'高い候補','manual://4',2,20,null,'',null);
  add.run(5,2,'別の利用者','manual://5',1,0,null,'',null);
  return db;
}

test('a low-priority item can be first with a rough month, no purchase day and its original notes', () => {
  const db = fixture();
  try {
    saveBuyGuide(db,1,{action:'guide',itemId:3,priority:4,month:'2027-01',timing:'by',condition:'セールになったら'});
    moveProduct(db,1,{action:'move',itemId:3,targetId:2,side:'before',scope:'all'});
    const order = db.prepare('SELECT id,sort_order FROM items WHERE user_id=1 ORDER BY sort_order,id').all();
    assert.deepEqual(order,[{id:3,sort_order:1},{id:1,sort_order:2},{id:2,sort_order:2},{id:4,sort_order:3}]);
    assert.deepEqual(db.prepare('SELECT priority,planned_purchase_date,notes FROM items WHERE id=3').get(),
      {priority:4,planned_purchase_date:null,notes:'メモ\nそのまま'});
    assert.deepEqual(attachBuyGuides(db,1,[{id:3}])[0].buy_guide,{month:'2027-01',timing:'by',condition:'セールになったら'});
    assert.throws(() => moveProduct(db,2,{action:'move',itemId:3,targetId:5,side:'before',scope:'all'}));
    assert.throws(() => saveBuyGuide(db,2,{action:'guide',itemId:3,priority:1,month:'',timing:'by',condition:''}));
    assert.equal(attachBuyGuides(db,2,[{id:3}])[0].buy_guide,undefined);
  } finally { db.close(); }
});

test('reordering one priority keeps other positions, and editing either shop updates the product as one', () => {
  const db = fixture();
  try {
    moveProduct(db,1,{action:'move',itemId:4,targetId:1,side:'before',scope:'priority'});
    assert.deepEqual(db.prepare('SELECT id FROM items WHERE user_id=1 ORDER BY sort_order,id').all(),[{id:4},{id:3},{id:1},{id:2}]);
    assert.throws(() => moveProduct(db,1,{action:'move',itemId:3,targetId:1,side:'before',scope:'priority'}));
    const guide = {month:'2027-03',timing:'around' as const,condition:'試着してから'};
    saveBuyGuide(db,1,{action:'guide',itemId:2,priority:3,...guide});
    assert.deepEqual(attachBuyGuides(db,1,[{id:1},{id:2}]).map(row => row.buy_guide),[guide,guide]);
    assert.deepEqual(db.prepare('SELECT notes,priority,planned_purchase_date FROM items WHERE comparison_group_id=7 ORDER BY id').all(),
      ['店 A のメモ','店 B のメモ'].map(notes => ({notes,priority:3,planned_purchase_date:'2027-01-07'})));
    const before = db.prepare('SELECT id,sort_order FROM items ORDER BY id').all();
    saveBuyGuide(db,1,{action:'guide',itemId:1,priority:1,month:'',timing:'by',condition:''});
    assert.equal(attachBuyGuides(db,1,[{id:2}])[0].buy_guide,undefined);
    assert.deepEqual(db.prepare('SELECT id,sort_order FROM items ORDER BY id').all(),before);
    assert.deepEqual(db.prepare('SELECT priority FROM comparison_groups WHERE id=7').get(),{priority:1});
  } finally { db.close(); }
});

test('a soft month can be omitted or shown as around or by, and invalid dates are rejected', () => {
  assert.equal(monthCaption('2027-01','by',2026),'2027年1月まで');
  assert.equal(monthCaption('2026-12','around',2026),'12月ごろ');
  assert.equal(monthCaption('','by',2026),'');
  const base = {action:'guide',itemId:2,priority:4,month:'',timing:'by',condition:'好みの色が入ったら'};
  assert.deepEqual(parseRankAction(base),base);
  for (const patch of [{month:'2026-13'},{month:'2027-01-01'},{priority:0},{condition:3},{itemId:-1}]) {
    assert.equal(parseRankAction({...base,...patch}),null);
  }
});

test('restoring a hidden shop cannot resurrect a stale guide or priority', () => {
  const db = fixture();
  try {
    saveBuyGuide(db, 1, {action:'guide', itemId:1, priority:3, month:'2027-01', timing:'by', condition:'古い条件'});
    for (const state of ["deleted_at='2026-11-22'", 'is_purchased=1']) {
      db.exec(`UPDATE items SET ${state} WHERE id=1`);
      moveProduct(db, 1, {action:'move', itemId:2, targetId:4, side:'after', scope:'all'});
      saveBuyGuide(db, 1, {action:'guide', itemId:2, priority:1, month:'2027-03', timing:'around', condition:'新しい条件'});
      db.exec('UPDATE items SET deleted_at=NULL,is_purchased=0 WHERE id=1');
      const order = db.prepare('SELECT sort_order FROM items WHERE id IN (1,2) ORDER BY id').all() as {sort_order:number}[];
      assert.equal(order[0].sort_order, order[1].sort_order);
      assert.deepEqual(attachBuyGuides(db, 1, [{id:1}, {id:2}]).map(item => item.buy_guide),
        [1,2].map(() => ({month:'2027-03', timing:'around', condition:'新しい条件'})));
      assert.deepEqual(db.prepare('SELECT priority FROM items WHERE comparison_group_id=7 ORDER BY id').all(), [{priority:1},{priority:1}]);
      db.exec(`UPDATE items SET ${state} WHERE id=1`);
      saveBuyGuide(db, 1, {action:'guide', itemId:2, priority:2, month:'', timing:'by', condition:''});
      db.exec('UPDATE items SET deleted_at=NULL,is_purchased=0 WHERE id=1');
      assert.equal(attachBuyGuides(db, 1, [{id:1}])[0].buy_guide, undefined);
    }
  } finally { db.close(); }
});
