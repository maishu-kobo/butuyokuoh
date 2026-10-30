/**
 * Plan bounded pages without splitting photo comparison groups.
 * Input order must already represent the complete filtered, sorted result.
 * @param {Array<{id:number,comparison_group_id:number|null,comparison_group_origin?:string|null}>} rows
 * @param {number} offset Row offset, never an item offset.
 * @param {number} limit Maximum visible rows (a photo row may contain several items).
 */
export function planItemPage(rows, offset = 0, limit = 50) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid offset');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid limit');
  /** @type {number[][]} */
  const units = [];
  /** @type {Map<number, number[]>} */
  const photos = new Map();
  const seen = new Set();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id)) {
      throw new TypeError('Expected unique positive item IDs');
    }
    seen.add(row.id);
    if (row.comparison_group_origin === 'photo' && row.comparison_group_id != null) {
      let members = photos.get(row.comparison_group_id);
      if (!members) {
        members = [];
        photos.set(row.comparison_group_id, members);
        units.push(members);
      }
      members.push(row.id);
    } else {
      units.push([row.id]);
    }
  }
  if (offset > units.length) throw new RangeError('Offset outside snapshot');
  const pageIds = new Set(units.slice(offset, offset + limit).flat());
  // Preserve the total ordering of the matched items within this page.
  const ids = rows.filter(row => pageIds.has(row.id)).map(row => row.id);
  const nextOffset = offset + limit < units.length ? offset + limit : null;
  return { ids, nextOffset, rowCount: units.length };
}
