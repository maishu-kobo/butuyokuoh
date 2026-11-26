import type { ComparisonGroup, Item } from '@/types';
import type { LightPalette, PreviewAppearance } from './design-palettes';
import { formatYen, wishlistRows, type WishlistRow } from './capture/list-card';
import { displayableItemImageUrl } from './capture/image-hosts';
import { photoFaceItemId, photoImageUrl } from './capture/photo-card-view';
import { lineAmount, sumCountedPrices } from './photo-spend';
import type { ListPreview } from './design-list-preview';
import { filterHomeItems, type HomeListQuery, type HomeSortBy } from './home-wishlist';
import { rankedProducts, rankItem } from './design-rank';

export type ReviewView = 'rank' | 'plan';
const reviewTabs = ['budget','manage','purchased','stats','trash','agents'] as const;
export type ReviewTab = typeof reviewTabs[number];
export function readReviewTab(input: unknown): ReviewTab | undefined {
  return reviewTabs.find(tab => tab === input);
}

export function readReviewView(value?: string | null): ReviewView {
  return value === 'plan' ? 'plan' : 'rank';
}

export function reviewHref(view: ReviewView, tab?: ReviewTab, palette?: LightPalette | null, appearance?: PreviewAppearance, list?:ListPreview): string {
  const query = new URLSearchParams();
  if (view === 'plan') query.set('view', view);
  if (tab) query.set('tab', tab);
  if (palette) query.set('palette', palette);
  if (palette && appearance === 'dark') query.set('appearance', appearance);
  if (list) query.set('list',list);
  return query.size ? '/design?' + query : '/design';
}

export function reviewSettingsHref(view: ReviewView, palette?: LightPalette | null, appearance?: PreviewAppearance): string {
  const query = new URLSearchParams({from:view});
  if (palette) query.set('palette',palette);
  if (palette && appearance === 'dark') query.set('appearance',appearance);
  return '/settings?' + query;
}

export interface ReviewProduct {
  key: string;
  name: string;
  row: WishlistRow<Item>;
  active: Item;
  face: Item;
  offers: Item[];
  image: string | null;
  addedAt: string;
}

export function buildReviewProducts(items: Item[], groups: ComparisonGroup[], purchased: Item[]): ReviewProduct[] {
  const itemById = new Map([...purchased, ...items].map(item => [item.id, item]));
  return wishlistRows(items, groups, purchased).map(row => {
    const offers = row.kind === 'item' ? [row.item] :
      row.shops.map(shop => itemById.get(shop.itemId)).filter((item): item is Item => !!item);
    const face = row.kind === 'item' ? row.item : itemById.get(photoFaceItemId(row))!;
    const active = offers.find(item => !item.is_purchased && item.countsInTotal !== false) ?? face;
    const isPhoto = row.kind === 'photo' || face.group_origin === 'photo' || face.comparison_group_origin === 'photo';
    const image = isPhoto ? photoImageUrl(face.source, face.image_url) : displayableItemImageUrl(face.image_url);
    return {
      key: row.kind === 'item' ? 'item-' + face.id : 'group-' + row.groupId,
      name: row.kind === 'item' ? face.name : row.name, row, active, face, offers, image,
      addedAt: offers.reduce((date, item) => item.created_at > date ? item.created_at : date, ''),
    };
  });
}

export function newestFirst(products: ReviewProduct[]): ReviewProduct[] {
  return [...products].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function filterReviewItems(items: Item[], groups: ComparisonGroup[], query: HomeListQuery & {priorities?:readonly number[]}, purchased: Item[] = []): Item[] {
  const needle = query.searchQuery.trim().toLocaleLowerCase('ja-JP');
  const groupNames = new Map(groups.map(group => [group.id, group.name]));
  const products = buildReviewProducts(items,groups,purchased);
  // 優先度は商品単位。写真の別店舗を別の優先度として絞り込まない。
  const priorityIds = query.priorities?.length ? new Set(products
    .filter(product=>query.priorities!.includes(rankItem(product).priority))
    .flatMap(product=>product.offers.map(offer=>offer.id))) : null;
  const matching = filterHomeItems(items, { ...query, searchQuery: '' }).filter(item => (!priorityIds || priorityIds.has(item.id)) && (!needle ||
    [item.name, item.notes, item.category_name, item.source_name, item.buy_guide?.condition,
      item.comparison_group_id && groupNames.get(item.comparison_group_id)]
      .some(value => typeof value === 'string' && value.toLocaleLowerCase('ja-JP').includes(needle))));
  // 写真棚も一覧と同じ商品順にする。検索に合わない店舗は選択対象に戻さない。
  const positions = new Map(managedProducts(products,matching,query.sortBy)
    .flatMap((product,index)=>product.offers.map(offer=>[offer.id,index] as const)));
  return matching.sort((a,b)=>positions.get(a.id)!-positions.get(b.id)!);
}

// Filter products without discarding their other shops or changing the budgeted offer.
export function managedProducts(products: ReviewProduct[], matchingItems: Item[], sortBy: HomeSortBy): ReviewProduct[] {
  const ids = new Set(matchingItems.map(item => item.id));
  const visible = rankedProducts(products.filter(product => product.offers.some(offer => ids.has(offer.id))));
  if (sortBy === 'priority' || sortBy === 'priority_desc') {
    return visible.sort((a,b)=>(rankItem(a).priority-rankItem(b).priority)*(sortBy==='priority'?1:-1));
  }
  return filterHomeItems(visible.map(product => ({ ...product.active, product, name: product.name, created_at: product.addedAt,
    // 写真商品は、予算に採用する店を変えても登録順を変えない。
    registrationId: Math.max(...product.offers.map(offer=>offer.id)),
  })), {
    sortBy, searchQuery: '', selectedCategory: null, selectedPriority: null, selectedGroup: null,
  }).map(entry => entry.product);
}

export function amountText(item: Item): string {
  return item.current_price == null ? '価格未取得' : formatYen(lineAmount(item.current_price, item.quantity));
}

export function groupByPlannedMonth(products: ReviewProduct[]) {
  const byMonth = new Map<string, ReviewProduct[]>();
  const sorted = [...products].sort((a, b) => (a.active.planned_purchase_date || '9999-99-99').localeCompare(b.active.planned_purchase_date || '9999-99-99'));
  for (const product of sorted) {
    const month = product.active.planned_purchase_date?.slice(0, 7) || '';
    const existing = byMonth.get(month);
    if (existing) existing.push(product);
    else byMonth.set(month, [product]);
  }
  return Array.from(byMonth, ([month, entries]) => ({
    month, products: entries, total: sumCountedPrices(entries.map(product => product.active)),
    unknownCount: entries.filter(({active}) => active.countsInTotal !== false && active.current_price == null).length,
  }));
}
