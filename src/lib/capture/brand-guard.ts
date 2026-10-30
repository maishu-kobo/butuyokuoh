// 自信ありのブランドは、種類が明らかに違うときだけ外す。文字が無いだけでは外さない。
// 文字を読んでいない型番（数字を含む）だけは外し、ブランドは残す。
// 写真のファイル名では判断しない。既定の推定はこの関数を通さない。
import type { IdentifyConfidence, IdentifyResponse, ProductGuess } from './contract';
import { colorInText, deviceCategory, dominantTypeGroup, productLine, statedProductType } from './product-query';

// メーカーではない許諾元。服や帽子の範囲を外れた種類を sure のブランドにしない。
const LICENSORS: { names: string[]; groups: string[] }[] = [
  { names: ['mlb', 'メジャーリーグ'], groups: ['shirts', 'caps', 'jackets'] },
  { names: ['nba', 'nfl', 'nhl'], groups: ['shirts', 'caps', 'jackets'] },
  { names: ['disney', 'ディズニー', 'marvel', 'マーベル', 'sanrio', 'サンリオ'], groups: ['shirts', 'caps', 'jackets'] },
];

// 知っているメーカーと、その種類。表に無いブランドは文字が無くても残す。
const MAKERS: { names: string[]; groups: string[] }[] = [
  { names: ['nike', 'ナイキ'], groups: ['shoes', 'shirts', 'caps', 'jackets'] },
  { names: ['adidas', 'アディダス', 'converse', 'コンバース'], groups: ['shoes'] },
  { names: ['mac'], groups: ['lips'] },
  { names: ['hp', 'dell', 'lenovo', 'asus'], groups: ['computers'] },
  { names: ['apple', 'アップル'], groups: ['computers', 'phones'] },
  { names: ['dyson', 'ダイソン'], groups: ['vacuums'] },
  { names: ['casio', 'カシオ'], groups: ['watches'] },
  { names: ['sony', 'ソニー'], groups: ['audio', 'cameras', 'phones', 'computers'] },
];

export const BRAND_EVIDENCE_SUFFIX = '各productにvisibleTextを足す。visibleTextは写真から読めた文字だけ。ロゴや刻印が無ければ空文字。推測したブランドや型番はvisibleTextに書かない。';

export interface BrandEvidence {
  textProvided: boolean;
  visibleText: string;
  productType: string | null;
  color: string | null;
}

export function guardSureBrand(input: {
  confidence: IdentifyConfidence;
  product: ProductGuess;
  evidence?: BrandEvidence | null;
}): { confidence: IdentifyConfidence; product: ProductGuess; guarded: boolean } {
  const evidence = input.evidence ?? null;
  if (input.confidence === 'sure') {
    const brand = claimedBrand(input.product);
    if (brand && domainConflicts(brand, evidence?.productType || input.product.name)) {
      return {
        confidence: 'unsure',
        product: { name: categoryLevelName(input.product, evidence), brand: null, model: null, jan: null },
        guarded: true,
      };
    }
  }
  const trimmed = stripUnreadModelNumber(input.product, evidence);
  if (!trimmed) return { confidence: input.confidence, product: input.product, guarded: false };
  return { confidence: input.confidence, product: trimmed, guarded: true };
}

export function guardIdentifyResult<T extends { ok: boolean; value?: IdentifyResponse }>(result: T): T {
  if (!result.ok || !result.value?.products[0]) return result;
  const guarded = guardSureBrand({
    confidence: result.value.confidence,
    product: result.value.products[0],
    evidence: result.value.evidence ?? null,
  });
  if (!guarded.guarded) return result;
  return {
    ...result,
    value: {
      ...result.value,
      confidence: guarded.confidence,
      products: [guarded.product, ...result.value.products.slice(1)],
    },
  };
}

function claimedBrand(product: ProductGuess): string | null {
  if (product.brand?.trim()) return product.brand.trim();
  if (product.model?.trim()) return null;
  if (statedProductType(product.name)) return null;
  const token = product.name.trim();
  if (!token || token.includes(' ')) return null;
  return token;
}

function domainConflicts(brand: string, categoryText: string): boolean {
  const wanted = dominantTypeGroup(categoryText);
  if (!wanted) return false;
  const folded = fold(brand);
  for (const licensor of LICENSORS) {
    if (!licensor.names.some((name) => folded === name || folded.includes(name))) continue;
    return !licensor.groups.includes(wanted);
  }
  for (const maker of MAKERS) {
    if (!maker.names.some((name) => folded === name)) continue;
    return !maker.groups.includes(wanted);
  }
  return false;
}

function stripUnreadModelNumber(product: ProductGuess, evidence: BrandEvidence | null): ProductGuess | null {
  const model = product.model?.trim() || '';
  const blob = `${model} ${product.name}`;
  if (!/\d/.test(blob)) return null;
  const text = evidence?.textProvided ? evidence.visibleText : '';
  if (text && (!model || includesFold(text, model)) && digitTokens(blob).every((token) => includesFold(text, token))) return null;
  const line = productLine(blob);
  const typeWord = statedProductType(evidence?.productType || '')
    || statedProductType(product.name)
    || line?.category
    || null;
  const color = colorInText(evidence?.color || '') || colorInText(product.name);
  const brand = product.brand?.trim() || '';
  const parts = [brand, line?.label, typeWord].filter((part): part is string => Boolean(part));
  if (typeWord && deviceCategory(typeWord) && !parts.some((part) => part.includes('本体'))) parts.push('本体');
  if (color && !parts.some((part) => includesFold(part, color))) parts.push(color);
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((item) => includesFold(item, part) || includesFold(part, item))) continue;
    unique.push(part);
  }
  const name = unique.join(' ').trim();
  if (!name || (brand && fold(name) === fold(brand))) return null;
  return copyLine(product, { name, brand: product.brand, model: null, jan: null });
}

function copyLine(source: ProductGuess, next: ProductGuess): ProductGuess {
  const series = source.series?.trim() || productLine(`${source.name} ${source.model ?? ''}`)?.label;
  if (series) next.series = series;
  if (source.formFactor) next.formFactor = source.formFactor;
  return next;
}

function digitTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => /\d/.test(token));
}

function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function categoryLevelName(product: ProductGuess, evidence: BrandEvidence | null): string {
  const typeWord = statedProductType(evidence?.productType || '') || statedProductType(product.name);
  const color = colorInText(evidence?.color || '') || colorInText(product.name);
  const brand = product.brand?.trim() || claimedBrand(product) || '';
  const model = product.model?.trim() || '';
  const descriptors = product.name.split(/\s+/).filter((token) => keepDescriptor(token, brand, model, typeWord));
  const parts = [typeWord, ...descriptors, color].filter((part): part is string => Boolean(part));
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((item) => includesFold(item, part) || includesFold(part, item))) continue;
    unique.push(part);
  }
  return unique.join(' ') || typeWord || color || product.name;
}

function keepDescriptor(token: string, brand: string, model: string, typeWord: string | null): boolean {
  if (token.length < 2 || /\d/.test(token) || /[A-Za-z]/.test(token)) return false;
  if (brand && includesFold(brand, token)) return false;
  if (model && includesFold(model, token)) return false;
  if (typeWord && includesFold(typeWord, token)) return false;
  if (colorInText(token) === token || statedProductType(token) === token) return false;
  return true;
}

function includesFold(text: string, token: string): boolean {
  if (!token) return false;
  return text.normalize('NFKC').toLocaleLowerCase('en-US').includes(token.normalize('NFKC').toLocaleLowerCase('en-US'));
}
