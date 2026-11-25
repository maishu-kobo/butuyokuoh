import { call, createMember, db, setTestUser } from './regression-harness';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/lib/db';

const route = '../src/app/api/items/ranking/route';
const path = '/api/items/ranking';
const origin = { origin: 'http://127.0.0.1' };
const guide = { action: 'guide', priority: 4, month: '2027-02', timing: 'around', condition: '値下がりしたら' };

test('ranking API authenticates, enforces origin/ownership and persists without changing a date or memo', async () => {
  delete process.env.AUTH_URL;
  delete process.env.NEXTAUTH_URL;
  const owner = await createMember('ranking-owner');
  process.env.AUTH_URL = 'http://127.0.0.1';
  const database = await db();
  const id = Number(database.prepare("INSERT INTO items(user_id,name,url,notes,planned_purchase_date) VALUES(?, '照明', 'manual://rank', 'メモを維持', '2027-03-01')").run(owner.id).lastInsertRowid);
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id }, undefined, origin)).status, 200);
  const items = await call('../src/app/api/items/route', 'GET', '/api/items?with=buy-guide');
  assert.deepEqual((items.json as {buy_guide: unknown}[])[0].buy_guide, {month: guide.month, timing: guide.timing, condition: guide.condition});
  const exported = await call('../src/app/api/export/route', 'GET', '/api/export');
  assert.equal(exported.status, 200);
  assert.match(exported.text, /買いたい月,時期の表し方,買う条件/);
  assert.match(exported.text, /2027-02,ごろに,値下がりしたら/);
  assert.deepEqual(database.prepare('SELECT notes, planned_purchase_date FROM items WHERE id=?').get(id), {notes: 'メモを維持', planned_purchase_date: '2027-03-01'});
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id }, undefined, {origin: 'https://foreign.example'})).status, 403);
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id, month: '2027-13' }, undefined, origin)).status, 400);
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id, condition: 'x'.repeat(20_000) }, undefined, origin)).status, 413);
  await createMember('ranking-other');
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id }, undefined, origin)).status, 404);
  await setTestUser(null);
  assert.equal((await call(route, 'POST', path, { ...guide, itemId: id }, undefined, origin)).status, 401);
  assert.deepEqual(database.prepare('SELECT month,condition FROM item_buy_guides WHERE item_id=?').get(id), {month: guide.month, condition: guide.condition});
});

test('opening an existing database adds the guide table, preserves rows and is repeatable', () => {
  const filename = join(mkdtempSync(join(tmpdir(), 'butuyokuoh-guide-migration-')), 'app.sqlite');
  let database = openDatabase(filename);
  database.prepare("INSERT INTO users(id,email) VALUES(1,'migration@example.test')").run();
  database.prepare("INSERT INTO items(id,user_id,name,url,notes) VALUES(1,1,'既存商品','manual://existing','元のメモ')").run();
  // Only this disposable fixture represents the schema before this change.
  database.exec('DROP TABLE item_buy_guides');
  database.close();
  for (let attempt = 0; attempt < 2; attempt++) {
    database = openDatabase(filename);
    assert.deepEqual(database.prepare('SELECT id,name,notes FROM items').all(), [{id: 1, name: '既存商品', notes: '元のメモ'}]);
    assert.deepEqual(database.prepare('SELECT COUNT(*) AS n FROM item_buy_guides').get(), {n: 0});
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    database.close();
  }
});

test('a combined guide request saves rank and rejects a foreign target without a partial save', async () => {
  const owner = await createMember('combined-ranking-owner');
  process.env.AUTH_URL = 'http://127.0.0.1';
  const database = await db();
  const add = database.prepare('INSERT INTO items(user_id,name,url,priority,sort_order) VALUES(?,?,?,?,?)');
  const first = Number(add.run(owner.id,'先頭','manual://combined-first',2,1).lastInsertRowid);
  const second = Number(add.run(owner.id,'次','manual://combined-second',3,2).lastInsertRowid);
  assert.equal((await call(route,'POST',path,{...guide,itemId:second,targetId:first,side:'before',scope:'all'},undefined,origin)).status,200);
  assert.deepEqual(database.prepare('SELECT id FROM items WHERE user_id=? ORDER BY sort_order,id').all(owner.id),[{id:second},{id:first}]);
  const other = await createMember('combined-ranking-other');
  const foreign = Number(add.run(other.id,'別の利用者','manual://combined-foreign',4,1).lastInsertRowid);
  await setTestUser(owner);
  assert.equal((await call(route,'POST',path,{...guide,itemId:second,priority:1,condition:'保存されない条件',targetId:foreign,side:'before',scope:'all'},undefined,origin)).status,404);
  assert.deepEqual(database.prepare('SELECT priority FROM items WHERE id=?').get(second),{priority:4});
  assert.deepEqual(database.prepare('SELECT condition FROM item_buy_guides WHERE item_id=?').get(second),{condition:guide.condition});
});
