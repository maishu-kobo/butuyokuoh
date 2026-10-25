// 写真から作った比較グループで、ショップが2件以上のときだけリストの1枚にまとめる。
// 1件だけのグループは、URLから登録した商品と同じ1件として出す。データベースは書き換えない。
// 手で作ったグループと、グループに入っていないアイテムは1件ずつそのまま返す。
import { linkableHttpUrl } from '@/lib/http-url';

export type ListItem = {
  id: number;
  name: string;
  url: string;
  current_price: number | null;
  source: string;
  source_name?: string | null;
  price_fetched_at?: string | null;
  comparison_group_id: number | null;
  comparison_group_name?: string | null;
  comparison_group_origin?: string | null;
  is_purchased: boolean | number;
  deleted_at?: string | null;
};

export type ListGroup = {
  id: number;
  origin?: string | null;
  name?: string | null;
};

export type PhotoShopLine = {
  itemId: number;
  name: string;
  site: string;
  shopName: string;
  price: number | null;
  fetchedAt: string | null;
  url: string | null;
  purchased: boolean;
};

export type WishlistRow<T extends ListItem = ListItem> =
  | { kind: 'item'; item: T }
  | {
      kind: 'photo';
      groupId: number;
      name: string;
      shops: PhotoShopLine[];
      minPrice: number | null;
      maxPrice: number | null;
      rangeText: string;
      itemIds: number[];
    };

const SITE_LABEL: Record<string, string> = {
  yahoo: 'Yahoo!ショッピング',
  rakuten: '楽天',
  amazon: 'Amazon',
  other: 'その他',
};

export function formatYen(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${sign}${digits}`;
}

export function formatYenSpan(min: number, max: number): string {
  return `${formatYen(min)}〜${formatYen(max)}`;
}

function siteLabel(source: string): string {
  return SITE_LABEL[source] ?? 'その他';
}

function purchased(item: ListItem): boolean {
  return item.is_purchased === true || item.is_purchased === 1;
}

function priceOf(item: ListItem): number | null {
  if (typeof item.current_price !== 'number' || !Number.isFinite(item.current_price)) return null;
  return item.current_price;
}

function photoGroupId(item: ListItem, groups: Map<number, ListGroup>): number | null {
  if (item.comparison_group_id == null) return null;
  const group = groups.get(item.comparison_group_id);
  if (group) return group.origin === 'photo' ? group.id : null;
  return item.comparison_group_origin === 'photo' ? item.comparison_group_id : null;
}

function shopLine(item: ListItem): PhotoShopLine {
  const site = siteLabel(item.source);
  const shopName = item.source_name?.trim() || site;
  return {
    itemId: item.id,
    name: item.name,
    site,
    shopName,
    price: priceOf(item),
    fetchedAt: item.price_fetched_at?.trim() ? item.price_fetched_at : null,
    url: linkableHttpUrl(item.url),
    purchased: purchased(item),
  };
}

function byPrice(a: ListItem, b: ListItem): number {
  const left = priceOf(a);
  const right = priceOf(b);
  if (left == null && right == null) return a.id - b.id;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left !== right) return left - right;
  return a.id - b.id;
}

export function wishlistRows<T extends ListItem>(visible: readonly T[], groups: readonly ListGroup[] = [], purchasedItems: readonly T[] = []): WishlistRow<T>[] {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const active = visible.filter((item) => !item.deleted_at);
  const activeIds = new Set(active.map((item) => item.id));
  const seen = new Set<number>();
  const rows: WishlistRow<T>[] = [];

  for (const item of active) {
    const groupId = photoGroupId(item, groupById);
    if (groupId == null) {
      rows.push({ kind: 'item', item });
      continue;
    }
    if (seen.has(groupId)) continue;
    seen.add(groupId);

    const members: T[] = active.filter((candidate) => photoGroupId(candidate, groupById) === groupId);
    for (const extra of purchasedItems) {
      if (extra.deleted_at || !purchased(extra) || photoGroupId(extra, groupById) !== groupId) continue;
      if (members.some((member) => member.id === extra.id)) continue;
      members.push(extra);
    }

    if (members.length < 2) {
      const face = members.find((member) => activeIds.has(member.id));
      if (face) rows.push({ kind: 'item', item: face });
      continue;
    }

    const prices = members.map(priceOf).filter((price): price is number => price != null);
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const group = groupById.get(groupId);
    const fallback = members.find((member) => activeIds.has(member.id)) ?? members[0];
    const name = group?.name?.trim() || fallback.comparison_group_name?.trim() || fallback.name;
    rows.push({
      kind: 'photo',
      groupId,
      name,
      shops: [...members].sort(byPrice).map(shopLine),
      minPrice,
      maxPrice,
      rangeText: minPrice == null || maxPrice == null ? '---' : formatYenSpan(minPrice, maxPrice),
      itemIds: members.filter((member) => activeIds.has(member.id)).map((member) => member.id),
    });
  }

  return rows;
}
