// llama 4 が見た種類・色・ブランドに、ブランドが一致したときだけ llama 3.2 のシリーズを足す。
import type { IdentifyConfidence, ProductGuess } from './contract';
import { colorInText, statedProductType } from './product-query';

export interface EnsembleGuess {
  confidence: IdentifyConfidence;
  product: ProductGuess | null;
}

function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function agrees(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const a = fold(left);
  const b = fold(right);
  return a === b || a.includes(b) || b.includes(a);
}

function grounded(product: ProductGuess | null): string | null {
  if (!product?.brand) return null;
  if (!product.name.toLocaleLowerCase('en-US').includes(product.brand.toLocaleLowerCase('en-US'))) return null;
  return product.brand;
}

export function ensembleGuess(
  broad: { confidence: IdentifyConfidence; product: ProductGuess | null },
  specific: { confidence: IdentifyConfidence; product: ProductGuess | null },
): EnsembleGuess {
  const category = statedProductType(broad.product?.name ?? '') ?? statedProductType(specific.product?.name ?? '');
  const color = colorInText(broad.product?.name ?? '') ?? colorInText(specific.product?.name ?? '');
  const broadBrand = grounded(broad.product);
  const specificBrand = grounded(specific.product);
  if (!category && !broad.product && !specific.product) return { confidence: 'unreadable', product: null };
  if (agrees(broadBrand, specificBrand)) {
    const model = specific.product?.model && !statedProductType(specific.product.model) ? specific.product.model : null;
    const name = [broadBrand, model, color, category].filter((part): part is string => Boolean(part)).join(' ');
    const sure = broad.confidence === 'sure' && specific.confidence === 'sure';
    return {
      confidence: sure ? 'sure' : 'unsure',
      product: { name: name || broad.product?.name || '', brand: broadBrand, model, jan: null },
    };
  }
  const name = [color, category].filter((part): part is string => Boolean(part)).join(' ')
    || broad.product?.name
    || specific.product?.name
    || '';
  if (!name) return { confidence: 'unreadable', product: null };
  return {
    confidence: 'unsure',
    product: { name, brand: broadBrand, model: null, jan: null },
  };
}
