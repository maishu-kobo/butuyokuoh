// 自信ありのブランドを、読めた文字か種類と衝突するときだけ外す。
// 写真のファイル名では判断しない。既定の推定はこの関数を通さない。
import type { IdentifyConfidence, IdentifyResponse, ProductGuess } from './contract';
import { colorInText, dominantTypeGroup, statedProductType } from './product-query';

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
  if (input.confidence !== 'sure') return { confidence: input.confidence, product: input.product, guarded: false };
  const brand = claimedBrand(input.product);
  const model = input.product.model?.trim() || null;
  if (!brand && !model) return { confidence: input.confidence, product: input.product, guarded: false };
  const unsupported = !brandIsEvidenced(brand, model, evidence) || categoryConflicts(input.product, evidence);
  if (!unsupported) return { confidence: input.confidence, product: input.product, guarded: false };
  const name = categoryLevelName(input.product, evidence);
  return {
    confidence: 'unsure',
    product: { name, brand: null, model: null, jan: null },
    guarded: true,
  };
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

function brandIsEvidenced(brand: string | null, model: string | null, evidence: BrandEvidence | null): boolean {
  if (!evidence?.textProvided) return false;
  const text = evidence.visibleText.trim();
  if (!text) return false;
  if (brand && !includesFold(text, brand)) return false;
  if (model && !includesFold(text, model)) return false;
  return true;
}

function categoryConflicts(product: ProductGuess, evidence: BrandEvidence | null): boolean {
  const wanted = dominantTypeGroup(evidence?.productType || product.name);
  if (!wanted) return false;
  const brandGroup = dominantTypeGroup(product.brand ?? '');
  if (brandGroup && brandGroup !== wanted) return true;
  const nameGroup = dominantTypeGroup(product.name);
  if (product.brand && nameGroup && nameGroup !== wanted) return true;
  return false;
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
