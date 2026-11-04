import type Database from 'better-sqlite3';
import { getDb } from '@/lib/db';
import { GuestError } from '@/lib/guest';

export type AgentComparisonGroup = {
  id: number;
  name: string;
  origin: string | null;
  item_count: number;
};

export function listAgentComparisonGroups(userId: number, db: Database.Database = getDb()) {
  return db.prepare(`
    SELECT g.id, g.name, g.origin, COUNT(i.id) AS item_count
    FROM comparison_groups g
    LEFT JOIN items i ON i.comparison_group_id = g.id AND i.user_id = g.user_id
      AND i.deleted_at IS NULL AND i.is_purchased = 0
    WHERE g.user_id = ?
    GROUP BY g.id
    ORDER BY g.priority ASC, g.created_at DESC, g.id DESC
  `).all(userId) as AgentComparisonGroup[];
}

export function createAgentComparisonGroup(
  userId: number,
  input: Record<string, unknown>,
  db: Database.Database = getDb(),
): AgentComparisonGroup {
  if (typeof input.name !== 'string' || input.name.length > 200) {
    throw new GuestError(400, 'INVALID_INPUT', '比較グループ名は1〜200文字で指定してください');
  }
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name) {
    throw new GuestError(400, 'INVALID_INPUT', '比較グループ名を入力してください');
  }
  // Web で作る手作業グループと同じ既定値（origin=NULL、priority=3）。
  // 所有者や origin はエージェントの引数から受け取らない。
  const result = db.prepare('INSERT INTO comparison_groups (user_id, name) VALUES (?, ?)')
    .run(userId, name);
  return { id: Number(result.lastInsertRowid), name, origin: null, item_count: 0 };
}
