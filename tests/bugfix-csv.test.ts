import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db } from './bugfix-harness';

test('csv prefixes formula cells so a spreadsheet does not execute them', async () => {
  const owner = await createMember('csv');
  const database = await db();
  const insert = database.prepare('INSERT INTO items (user_id, name, url, notes) VALUES (?, ?, ?, ?)');
  insert.run(owner.id, '=1+1', 'https://example.com/eq', null);
  insert.run(owner.id, '足す', 'https://example.com/plus', '+1+1');
  insert.run(owner.id, '-2+3', 'https://example.com/minus', null);
  insert.run(owner.id, '@SUM(A1)', 'https://example.com/at', null);
  insert.run(owner.id, '\t=1', 'https://example.com/tab', null);
  insert.run(owner.id, '\r=1', 'https://example.com/cr', null);
  insert.run(owner.id, '=1,2', 'https://example.com/comma', null);
  insert.run(owner.id, '=say "hi"', 'https://example.com/quote', null);
  insert.run(owner.id, 'キーボード', 'https://example.com/plain', '普通のメモ');

  const response = await call('../src/app/api/export/route.ts', 'GET', '/api/export?filter=all');
  assert.equal(response.status, 200);
  const csv = response.text.replace(/^\uFEFF/, '');

  assert.match(csv, /'=1\+1,/);
  assert.match(csv, /,'\+1\+1,/);
  assert.match(csv, /'-2\+3,/);
  assert.match(csv, /'@SUM\(A1\),/);
  assert.match(csv, /'\t=1,/);
  assert.match(csv, /'\r=1/);
  assert.match(csv, /"'=1,2"/);
  assert.match(csv, /"'=say ""hi"""/);
  assert.match(csv, /キーボード,https:\/\/example.com\/plain/);
  assert.match(csv, /,普通のメモ,/);
  assert.equal(csv.includes('\n=1+1,'), false);
});
