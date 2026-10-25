import './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, createMember, db, setTestUser } from './regression-harness';

const groupRoute = '../src/app/api/comparison-groups/[id]/route.ts';

test('deleting a comparison group nulls capture references and keeps the capture row', async () => {
  const owner = await createMember('group-delete-capture');
  await setTestUser(owner);
  const database = await db();
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);

  const groupId = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority, origin) VALUES (?, '写真の牛乳', 3, 'photo')",
  ).run(owner.id).lastInsertRowid);
  const otherGroupId = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name, priority) VALUES (?, '残すグループ', 2)",
  ).run(owner.id).lastInsertRowid);
  const itemId = Number(database.prepare(
    `INSERT INTO items (user_id, name, url, current_price, comparison_group_id, source)
     VALUES (?, '牛乳', 'https://example.test/milk', 198, ?, 'yahoo')`,
  ).run(owner.id, groupId).lastInsertRowid);
  const captureId = Number(database.prepare(
    `INSERT INTO captures (user_id, estimated_name, status, comparison_group_id, registered_item_id)
     VALUES (?, '牛乳', 'registered', ?, ?)`,
  ).run(owner.id, groupId, itemId).lastInsertRowid);
  const otherCaptureId = Number(database.prepare(
    `INSERT INTO captures (user_id, estimated_name, status, comparison_group_id)
     VALUES (?, '別の写真', 'registered', ?)`,
  ).run(owner.id, otherGroupId).lastInsertRowid);

  const deleted = await call(
    groupRoute,
    'DELETE',
    `/api/comparison-groups/${groupId}`,
    undefined,
    { id: String(groupId) },
  );
  assert.equal(deleted.status, 200);

  const capture = database.prepare(
    'SELECT id, status, comparison_group_id, registered_item_id FROM captures WHERE id = ?',
  ).get(captureId) as {
    id: number;
    status: string;
    comparison_group_id: number | null;
    registered_item_id: number | null;
  };
  assert.equal(capture.id, captureId);
  assert.equal(capture.status, 'registered');
  assert.equal(capture.comparison_group_id, null);
  assert.equal(capture.registered_item_id, itemId);
  assert.deepEqual(
    database.prepare('SELECT id, comparison_group_id FROM captures WHERE id = ?').get(otherCaptureId),
    { id: otherCaptureId, comparison_group_id: otherGroupId },
  );
  assert.deepEqual(
    database.prepare('SELECT id, comparison_group_id FROM items WHERE id = ?').get(itemId),
    { id: itemId, comparison_group_id: null },
  );
  assert.equal(database.prepare('SELECT id FROM comparison_groups WHERE id = ?').get(groupId), undefined);
  assert.ok(database.prepare('SELECT id FROM comparison_groups WHERE id = ?').get(otherGroupId));
});

test('deleting a comparison group with no capture reference still succeeds', async () => {
  const owner = await createMember('group-delete-plain');
  await setTestUser(owner);
  const database = await db();

  const groupId = Number(database.prepare(
    "INSERT INTO comparison_groups (user_id, name) VALUES (?, '手のグループ')",
  ).run(owner.id).lastInsertRowid);
  const itemId = Number(database.prepare(
    `INSERT INTO items (user_id, name, url, comparison_group_id)
     VALUES (?, '本', 'manual://book', ?)`,
  ).run(owner.id, groupId).lastInsertRowid);
  const captureId = Number(database.prepare(
    "INSERT INTO captures (user_id, estimated_name, status) VALUES (?, '未登録の写真', 'open')",
  ).run(owner.id).lastInsertRowid);

  const deleted = await call(
    groupRoute,
    'DELETE',
    `/api/comparison-groups/${groupId}`,
    undefined,
    { id: String(groupId) },
  );
  assert.equal(deleted.status, 200);
  assert.equal(database.prepare('SELECT id FROM comparison_groups WHERE id = ?').get(groupId), undefined);
  assert.deepEqual(
    database.prepare('SELECT id, comparison_group_id FROM items WHERE id = ?').get(itemId),
    { id: itemId, comparison_group_id: null },
  );
  assert.deepEqual(
    database.prepare('SELECT id, status, comparison_group_id FROM captures WHERE id = ?').get(captureId),
    { id: captureId, status: 'open', comparison_group_id: null },
  );
});
