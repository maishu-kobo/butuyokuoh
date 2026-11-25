import type Database from 'better-sqlite3';
import { GuestError } from './guest';
import type { BuyGuide, GuideAction, MoveAction } from './design-rank';

export function attachBuyGuides<T extends {id:number}>(db: Database.Database, userId: number, items: T[]): (T & {buy_guide?: BuyGuide})[] {
  const rows = db.prepare(`SELECT g.* FROM item_buy_guides g JOIN items i ON i.id=g.item_id
    WHERE i.user_id=? AND i.is_purchased=0 AND i.deleted_at IS NULL`).all(userId) as (BuyGuide & {item_id:number})[];
  const guides = new Map(rows.map(({item_id,month,timing,condition}) => [item_id,{month,timing,condition}]));
  return items.map(item => guides.has(item.id) ? {...item,buy_guide:guides.get(item.id)} : item);
}

type Offer = {id:number; priority:number; photo_group:number|null; sort_order:number};
type Entry = { offers:Offer[]; firstId:number; sortOrder:number; priority:number };
function activeProducts(db:Database.Database,userId:number) {
  const offers = db.prepare(`SELECT i.id,i.priority,i.sort_order, CASE WHEN g.origin='photo' THEN g.id END AS photo_group
    FROM items i LEFT JOIN comparison_groups g ON g.id=i.comparison_group_id AND g.user_id=i.user_id
    WHERE i.user_id=? AND i.is_purchased=0 AND i.deleted_at IS NULL ORDER BY i.id`).all(userId) as Offer[];
  const products = new Map<string,Entry>();
  const byOffer = new Map<number,Entry>();
  for (const offer of offers) {
    const key = offer.photo_group == null ? 'i'+offer.id : 'g'+offer.photo_group;
    const entry = products.get(key) ?? {offers:[],firstId:offer.id,sortOrder:offer.sort_order,priority:offer.priority};
    entry.offers.push(offer);
    entry.sortOrder = Math.min(entry.sortOrder,offer.sort_order);
    products.set(key,entry);
    byOffer.set(offer.id,entry);
  }
  return {byOffer, order:[...products.values()].sort((a,b) => a.sortOrder-b.sortOrder || a.firstId-b.firstId)};
}
function requireProduct(byOffer:Map<number,Entry>,id:number): Entry {
  const product = byOffer.get(id);
  if (!product) throw new GuestError(404,'ITEM_NOT_FOUND','商品が移動しました。リストを読み直してください。');
  return product;
}
export function moveProduct(db:Database.Database,userId:number,action:MoveAction) {
  db.transaction(() => {
    const {order,byOffer} = activeProducts(db,userId);
    const source = requireProduct(byOffer,action.itemId);
    const target = requireProduct(byOffer,action.targetId);
    if (source === target) return;
    const inScope = (entry:Entry) => action.scope === 'all' || entry.priority === source.priority;
    if (!inScope(target)) throw new GuestError(409,'PRIORITY_CHANGED','優先度が変わりました。リストを読み直してください。');
    const moved = order.filter(entry => inScope(entry) && entry !== source);
    moved.splice(moved.indexOf(target) + (action.side === 'after' ? 1 : 0),0,source);
    const update = db.prepare("UPDATE items SET sort_order=?,updated_at=datetime('now') WHERE user_id=? AND id=? AND sort_order<>?");
    const updateGroup = db.prepare("UPDATE items SET sort_order=?,updated_at=datetime('now') WHERE user_id=? AND comparison_group_id=? AND sort_order<>?");
    let slot = 0;
    order.forEach((entry,index) => {
      const product = inScope(entry) ? moved[slot++] : entry;
      const group = product.offers[0].photo_group;
      if (group !== null) updateGroup.run(index+1,userId,group,index+1);
      else for (const offer of product.offers) update.run(index+1,userId,offer.id,index+1);
    });
  }).immediate();
}
export function saveBuyGuide(db:Database.Database,userId:number,action:GuideAction) {
  db.transaction(() => {
    const {byOffer} = activeProducts(db,userId);
    const product = requireProduct(byOffer,action.itemId);
    // A photo product keeps one guide even if a shop is purchased or in the trash.
    // Restoring an older offer must not resurrect an obsolete priority or condition.
    const group = product.offers[0].photo_group;
    const offers = group === null ? product.offers : db.prepare(
      'SELECT id FROM items WHERE comparison_group_id=? AND user_id=?',
    ).all(group, userId) as {id: number}[];
    const put = db.prepare(`INSERT INTO item_buy_guides(item_id,month,timing,condition) VALUES(?,?,?,?)
      ON CONFLICT(item_id) DO UPDATE SET month=excluded.month,timing=excluded.timing,condition=excluded.condition`);
    const clear = db.prepare('DELETE FROM item_buy_guides WHERE item_id=?');
    const priority = db.prepare("UPDATE items SET priority=?,updated_at=datetime('now') WHERE id=? AND user_id=? AND priority<>?");
    for (const offer of offers) {
      priority.run(action.priority,offer.id,userId,action.priority);
      if (action.month || action.condition) put.run(offer.id,action.month,action.timing,action.condition);
      else clear.run(offer.id);
    }
    if (group !== null) db.prepare('UPDATE comparison_groups SET priority=? WHERE id=? AND user_id=?').run(action.priority,group,userId);
    // Keep the guide and rank in one transaction. A stale destination must roll back both.
    if (action.targetId !== undefined) moveProduct(db,userId,{action:'move',itemId:action.itemId,
      targetId:action.targetId,side:action.side,scope:action.scope});
  }).immediate();
}
