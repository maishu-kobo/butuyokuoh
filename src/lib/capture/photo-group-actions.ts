// 写真グループのカードから消す・優先度を変える・比較グループを変えるときは、
// ショップ全員に同じ操作を届ける。店ごとの名前、URL、価格は代表の1件だけ。
// 1件だけの登録は、その1件だけの操作のままにする。
// 開いた中の1店を消すときは、その店だけをゴミ箱へ送る。
// 残っているのがその1店だけなら、その削除が商品そのものになる。

export interface PhotoGroupSaveWrite {
  id: number;
  body: Record<string, unknown>;
}

const SHARED_KEYS = ['priority', 'comparison_group_id'] as const;

function uniqueIds(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function targets(memberIds: readonly number[], faceId: number): number[] {
  const ids = uniqueIds(memberIds);
  if (ids.length < 2) return [faceId];
  if (ids.includes(faceId)) return ids;
  return [faceId, ...ids];
}

export function photoGroupDeleteIds(memberIds: readonly number[], faceId: number): number[] {
  return targets(memberIds, faceId);
}

export function photoShopDeleteIds(memberIds: readonly number[], shopId: number): number[] {
  const ids = uniqueIds(memberIds);
  if (!Number.isInteger(shopId) || shopId <= 0 || !ids.includes(shopId)) return [];
  return [shopId];
}

export function photoGroupSaveWrites(
  memberIds: readonly number[],
  faceId: number,
  body: Record<string, unknown>,
): PhotoGroupSaveWrite[] {
  const shared: Record<string, unknown> = {};
  for (const key of SHARED_KEYS) {
    if (body[key] !== undefined) shared[key] = body[key];
  }
  const share = Object.keys(shared).length > 0;
  return targets(memberIds, faceId).flatMap((id) => {
    if (id !== faceId && !share) return [];
    return [{ id, body: id === faceId ? body : shared }];
  });
}
