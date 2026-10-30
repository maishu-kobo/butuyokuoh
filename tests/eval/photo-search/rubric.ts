// 23枚の採点。ブランドが写真に見えないものは none。
import { categoryMismatch } from '../../../src/lib/capture/product-query';

export interface PhotoScoreCard {
  id: string;
  brand: string | null;
  aliases: string[];
  categoryTerms: string[];
}

export const PHOTO_SCORECARDS: readonly PhotoScoreCard[] = [
  { id: 'balenciaga-arena', brand: 'Balenciaga', aliases: ['balenciaga', 'バレンシアガ'], categoryTerms: ['スニーカー', 'シューズ', '靴'] },
  { id: 'adidas-leather-tennis', brand: 'Adidas', aliases: ['adidas', 'アディダス'], categoryTerms: ['スニーカー', 'シューズ', '靴'] },
  { id: 'nike-cortez', brand: 'Nike', aliases: ['nike', 'ナイキ', 'cortez', 'コルテッツ'], categoryTerms: ['スニーカー', 'シューズ'] },
  { id: 'converse-all-star', brand: 'Converse', aliases: ['converse', 'コンバース', 'all star', 'オールスター'], categoryTerms: ['スニーカー', 'シューズ'] },
  { id: 'oxford-brogue', brand: null, aliases: [], categoryTerms: ['シューズ', '靴', '革靴'] },
  { id: 'birkenstock-arizona', brand: 'Birkenstock', aliases: ['birkenstock', 'ビルケン'], categoryTerms: ['サンダル'] },
  { id: 'prada-tooled-handbag', brand: 'Prada', aliases: ['prada', 'プラダ'], categoryTerms: ['バッグ', 'ハンドバッグ', '鞄'] },
  { id: 'trekking-backpack', brand: null, aliases: [], categoryTerms: ['バックパック', 'リュック', 'バッグ'] },
  { id: 'rune-cotton-tote', brand: null, aliases: [], categoryTerms: ['トート', 'バッグ'] },
  { id: 'iphone-5', brand: 'Apple', aliases: ['iphone', 'apple', 'アップル'], categoryTerms: ['iphone', 'スマホ', 'スマートフォン'] },
  { id: 'bose-headphones', brand: 'Bose', aliases: ['bose', 'ボーズ'], categoryTerms: ['ヘッドホン', 'ヘッドフォン'] },
  { id: 'adapted-mirrorless-camera', brand: 'Olympus', aliases: ['olympus', 'オリンパス', 'om-d'], categoryTerms: ['カメラ'] },
  { id: 'broken-laptop-2006', brand: 'HP', aliases: ['hp'], categoryTerms: ['ノート', 'パソコン', 'laptop'] },
  { id: 'casio-g-shock', brand: 'Casio', aliases: ['casio', 'カシオ', 'g-shock'], categoryTerms: ['腕時計', 'g-shock', '時計'] },
  { id: 'mac-lipstick', brand: 'MAC', aliases: ['mac', 'マック'], categoryTerms: ['リップ', '口紅'] },
  { id: 'coty-suma-perfume', brand: 'Coty', aliases: ['coty', 'コティ'], categoryTerms: ['香水', 'フレグランス'] },
  { id: 'denim-jacket', brand: null, aliases: [], categoryTerms: ['ジャケット', 'デニム', 'gジャン'] },
  { id: 'blue-jeans', brand: null, aliases: [], categoryTerms: ['ジーンズ', 'デニム', 'パンツ'] },
  { id: 'hema-white-tshirt', brand: null, aliases: [], categoryTerms: ['tシャツ', 'シャツ'] },
  { id: 'ceramic-mugs', brand: null, aliases: [], categoryTerms: ['マグ', 'カップ'] },
  { id: 'dyson-v10-vacuum', brand: 'Dyson', aliases: ['dyson', 'ダイソン'], categoryTerms: ['掃除機'] },
  { id: 'pen-writing-example', brand: null, aliases: [], categoryTerms: ['ペン', 'ボールペン'] },
  { id: 'alb-wristwatch', brand: 'A.L.B', aliases: ['a.l.b', 'alb'], categoryTerms: ['腕時計', '時計', 'ウォッチ'] },
];

export interface PhotoScoreInput {
  id: string;
  confidence: string | null;
  name: string | null;
  brand: string | null;
  hits: number;
  top3: string[];
}

export interface PhotoScore {
  category: boolean;
  brand: boolean | null;
  noWrongBrand: boolean;
  hits: boolean;
  points: number;
}

function has(text: string, aliases: readonly string[]): boolean {
  const folded = text.normalize('NFKC').toLocaleLowerCase('en-US');
  return aliases.some((alias) => folded.includes(alias.normalize('NFKC').toLocaleLowerCase('en-US')));
}

export function scorePhoto(input: PhotoScoreInput, cards: readonly PhotoScoreCard[] = PHOTO_SCORECARDS): PhotoScore {
  const card = cards.find((item) => item.id === input.id);
  const blob = `${input.name ?? ''} ${input.brand ?? ''}`;
  const category = card ? input.top3.some((title) => has(title, card.categoryTerms)) : false;
  const conflict = card ? input.top3.some((title) => categoryMismatch(card.categoryTerms[0], title)) : false;
  const categoryOk = category && !conflict;
  const brand = !card || card.brand === null ? null : has(blob, card.aliases);
  const stated = (input.brand ?? '').trim();
  const sure = input.confidence === 'sure';
  const wrongBrand = sure && stated.length > 0 && card !== undefined && (card.brand === null || !has(stated, card.aliases));
  const noWrongBrand = !wrongBrand;
  const hits = input.hits > 0;
  const points = Number(categoryOk) + (brand === null ? 0 : Number(brand)) + Number(noWrongBrand) + Number(hits);
  return { category: categoryOk, brand, noWrongBrand, hits, points };
}


/** Exact identifiers must be curated independently of the model's output. */
export function exactProductTop5(titles: readonly string[], identifiers: readonly string[] | undefined): boolean | null {
  if (!identifiers?.length) return null;
  return titles.slice(0, 5).some((title) => identifiers.some((identifier) => {
    const escaped = identifier.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i').test(title.normalize('NFKC'));
  }));
}
