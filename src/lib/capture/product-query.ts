// 写真の推定を、ブランド名だけに落ちない検索語へ整える。
// 種類は商品名に残す。商品名に無い別ブランドは足さない。
// 0件のときは型番だけを外し、種類は残す。

export interface CapturedFields {
  name: string;
  brand: string | null;
  model: string | null;
  productType: string | null;
  color: string | null;
}

export interface CapturedProduct {
  name: string;
  brand: string | null;
  model: string | null;
}

interface Term {
  group: string;
  term: string;
  canonical: string;
}

const TERMS: readonly Term[] = [
  { group: 'shoes', term: 'スニーカー', canonical: 'スニーカー' },
  { group: 'shoes', term: 'シューズ', canonical: 'シューズ' },
  { group: 'shoes', term: '革靴', canonical: '革靴' },
  { group: 'shoes', term: 'サンダル', canonical: 'サンダル' },
  { group: 'shoes', term: 'ブーツ', canonical: 'ブーツ' },
  { group: 'shoes', term: 'パンプス', canonical: 'パンプス' },
  { group: 'shoes', term: 'ローファー', canonical: 'ローファー' },
  { group: 'shoes', term: 'sneakers', canonical: 'スニーカー' },
  { group: 'shoes', term: 'sneaker', canonical: 'スニーカー' },
  { group: 'shoes', term: 'sandals', canonical: 'サンダル' },
  { group: 'shoes', term: 'sandal', canonical: 'サンダル' },
  { group: 'shoes', term: 'shoes', canonical: 'シューズ' },
  { group: 'bags', term: 'ショルダーバッグ', canonical: 'ショルダーバッグ' },
  { group: 'bags', term: '手提げ袋', canonical: 'ハンドバッグ' },
  { group: 'bags', term: 'ハンドバッグ', canonical: 'ハンドバッグ' },
  { group: 'bags', term: 'トートバッグ', canonical: 'トートバッグ' },
  { group: 'bags', term: 'backpack', canonical: 'バックパック' },
  { group: 'bags', term: 'tote', canonical: 'トートバッグ' },
  { group: 'bags', term: 'バックパック', canonical: 'バックパック' },
  { group: 'bags', term: 'リュック', canonical: 'リュック' },
  { group: 'bags', term: 'バッグ', canonical: 'バッグ' },
  { group: 'bags', term: 'handbag', canonical: 'ハンドバッグ' },
  { group: 'wallets', term: '財布', canonical: '財布' },
  { group: 'phones', term: 'スマートフォン', canonical: 'スマートフォン' },
  { group: 'phones', term: 'iPhone', canonical: 'iPhone' },
  { group: 'audio', term: 'headphones', canonical: 'ヘッドホン' },
  { group: 'audio', term: 'headphone', canonical: 'ヘッドホン' },
  { group: 'audio', term: 'ヘッドホン', canonical: 'ヘッドホン' },
  { group: 'audio', term: 'ヘッドフォン', canonical: 'ヘッドフォン' },
  { group: 'cameras', term: 'camera', canonical: 'カメラ' },
  { group: 'cameras', term: 'カメラ', canonical: 'カメラ' },
  { group: 'computers', term: 'laptop', canonical: 'ノートパソコン' },
  { group: 'computers', term: 'ノートパソコン', canonical: 'ノートパソコン' },
  { group: 'computers', term: 'MacBook', canonical: 'MacBook' },
  { group: 'lips', term: 'lipstick', canonical: '口紅' },
  { group: 'lips', term: '口紅', canonical: '口紅' },
  { group: 'lips', term: 'リップ', canonical: 'リップ' },
  { group: 'perfume', term: 'perfume', canonical: '香水' },
  { group: 'perfume', term: 'フレグランス', canonical: 'フレグランス' },
  { group: 'perfume', term: '香水', canonical: '香水' },
  { group: 'shirts', term: 'Tシャツ', canonical: 'Tシャツ' },
  { group: 'shirts', term: 'シャツ', canonical: 'シャツ' },
  { group: 'jackets', term: 'jacket', canonical: 'ジャケット' },
  { group: 'jackets', term: 'ジャケット', canonical: 'ジャケット' },
  { group: 'jeans', term: 'jeans', canonical: 'ジーンズ' },
  { group: 'jeans', term: 'ジーンズ', canonical: 'ジーンズ' },
  { group: 'jeans', term: 'デニム', canonical: 'デニム' },
  { group: 'mugs', term: 'mugs', canonical: 'マグカップ' },
  { group: 'mugs', term: 'mug', canonical: 'マグカップ' },
  { group: 'mugs', term: 'マグカップ', canonical: 'マグカップ' },
  { group: 'mugs', term: 'マグ', canonical: 'マグ' },
  { group: 'vacuums', term: 'vaccum', canonical: '掃除機' },
  { group: 'vacuums', term: 'vacuum', canonical: '掃除機' },
  { group: 'vacuums', term: '掃除機', canonical: '掃除機' },
  { group: 'watches', term: 'watch', canonical: '腕時計' },
  { group: 'watches', term: 'G-SHOCK', canonical: 'G-SHOCK' },
  { group: 'watches', term: '腕時計', canonical: '腕時計' },
  { group: 'pens', term: 'pen', canonical: 'ペン' },
  { group: 'pens', term: 'ボールペン', canonical: 'ボールペン' },
  { group: 'caps', term: 'キャップ', canonical: 'キャップ' },
  { group: 'socks', term: 'ソックス', canonical: 'ソックス' },
];

const COLORS: readonly [string, string][] = [
  ['ブラック', 'ブラック'],
  ['黒', '黒'],
  ['black', 'ブラック'],
  ['ホワイト', 'ホワイト'],
  ['白', '白'],
  ['white', 'ホワイト'],
  ['レッド', 'レッド'],
  ['赤', '赤'],
  ['red', 'レッド'],
  ['ブルー', 'ブルー'],
  ['青', '青'],
  ['blue', 'ブルー'],
  ['グリーン', 'グリーン'],
  ['緑', '緑'],
  ['ブラウン', 'ブラウン'],
  ['茶', '茶'],
  ['brown', 'ブラウン'],
  ['グレー', 'グレー'],
  ['灰色', '灰色'],
  ['gray', 'グレー'],
  ['grey', 'グレー'],
  ['ベージュ', 'ベージュ'],
  ['ピンク', 'ピンク'],
  ['pink', 'ピンク'],
  ['ネイビー', 'ネイビー'],
  ['ゴールド', 'ゴールド'],
  ['シルバー', 'シルバー'],
  ['パープル', 'パープル'],
  ['purple', 'パープル'],
  ['イエロー', 'イエロー'],
  ['オレンジ', 'オレンジ'],
];

// 以前の指示文に書いた見本。モデルがそのまま写した名前は商品にしない。
export const PROMPT_PRODUCT_EXAMPLES = ['バレンシアガ シューズ'] as const;

const NAME_MAX = 200;

function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function includesTerm(text: string, term: string): boolean {
  const hay = fold(text);
  const needle = fold(term);
  if (!needle) return false;
  if (needle === 'リップ') {
    return /(?<!ク)リップ/.test(hay);
  }
  if (/^[a-z0-9-]+$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(hay);
  }
  return hay.includes(needle);
}

function includesLabel(text: string, token: string): boolean {
  const needle = token.trim();
  if (!needle) return false;
  return fold(text).includes(fold(needle));
}

function bestTerm(text: string): Term | null {
  let best: Term | null = null;
  for (const entry of TERMS) {
    if (!includesTerm(text, entry.term)) continue;
    if (!best || entry.term.length > best.term.length) best = entry;
  }
  return best;
}

export function nameHasProductType(text: string): boolean {
  return bestTerm(text) !== null;
}

export function dominantTypeGroup(text: string): string | null {
  return bestTerm(text)?.group ?? null;
}

function canonicalType(value: string | null): string | null {
  if (!value || value.includes('/')) return null;
  return bestTerm(value)?.canonical ?? null;
}

function canonicalColor(value: string | null): string | null {
  if (!value || value.includes('/')) return null;
  const key = fold(value.trim());
  for (const [from, to] of COLORS) {
    if (key === fold(from)) return to;
  }
  return null;
}

function visibleBrand(name: string, brand: string | null): string | null {
  if (!brand) return null;
  const trimmed = brand.trim();
  if (!trimmed || trimmed.includes('/')) return null;
  if (includesLabel(name, trimmed)) return trimmed;
  const stripped = trimmed.replace(/^ザ・/u, '').replace(/・/g, '');
  if (stripped !== trimmed && stripped.length >= 2 && includesLabel(name, stripped)) return stripped;
  return null;
}

function isOnlyType(value: string): boolean {
  if (!nameHasProductType(value)) return false;
  let rest = ` ${fold(value)} `;
  const terms = [...TERMS].sort((left, right) => right.term.length - left.term.length);
  for (const entry of terms) {
    rest = rest.split(fold(entry.term)).join(' ');
  }
  return rest.trim().length === 0;
}

// 色と種類だけ。ブランドやシリーズの語が残る名前は、ここには入らない。
export function nameIsColorAndType(text: string): boolean {
  if (!nameHasProductType(text)) return false;
  let rest = ` ${fold(text)} `;
  const terms = [...TERMS].sort((left, right) => right.term.length - left.term.length);
  for (const entry of terms) rest = rest.split(fold(entry.term)).join(' ');
  const colors = [...COLORS].sort((left, right) => right[0].length - left[0].length);
  for (const [from] of colors) rest = rest.split(fold(from)).join(' ');
  return rest.split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/i).every((token) => token.length <= 1);
}

function clip(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= NAME_MAX) return cleaned;
  return cleaned.slice(0, NAME_MAX).trim();
}

function stripTrailingTypes(value: string): string {
  let tokens = value.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && isOnlyType(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  return tokens.join(' ');
}

function seriesRemainder(name: string, brand: string): string | null {
  if (!includesLabel(name, brand)) return null;
  const index = fold(name).indexOf(fold(brand));
  if (index < 0) return null;
  let rest = `${name.slice(0, index)} ${name.slice(index + brand.length)}`.replace(/\s+/g, ' ').trim();
  rest = rest.replace(/^[-‐‑–—\s]+|[-‐‑–—\s]+$/g, '').trim();
  rest = stripTrailingTypes(rest).replace(/^[-‐‑–—\s]+|[-‐‑–—\s]+$/g, '').trim();
  if (rest.length < 2 || isOnlyType(rest) || canonicalColor(rest)) return null;
  if (fold(rest) === fold(brand)) return null;
  return rest;
}

function stripTrailingColorAndType(name: string): string {
  let tokens = name.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (canonicalColor(last) || isOnlyType(last)) {
      tokens = tokens.slice(0, -1);
      continue;
    }
    break;
  }
  return tokens.join(' ');
}

export function copiedPromptExample(name: string): boolean {
  const forms = [name.trim(), stripTrailingColorAndType(name)];
  return forms.some((form) => PROMPT_PRODUCT_EXAMPLES.some((example) => fold(form) === fold(example)));
}

export function composeCapturedProduct(input: CapturedFields & { recoverSeries?: boolean }): CapturedProduct {
  const denied = /ブランド名の(?:ない|無い)/.test(input.name);
  const name = input.name.replace(/ブランド名の(?:ない|無い)/g, ' ').replace(/\s+/g, ' ').trim();
  const brand = denied ? null : visibleBrand(name, input.brand);
  let model = input.model?.trim() || null;
  if (model?.includes('/')) model = null;
  let typeHint = input.productType;
  if (model && brand && fold(model) === fold(brand)) model = null;
  if (model && fold(model) === fold(name)) model = null;
  if (model && isOnlyType(model)) {
    typeHint = canonicalType(typeHint) ? typeHint : model;
    model = null;
  }
  if (model && !includesLabel(name, model)) model = null;
  if (input.recoverSeries !== false && !model && brand) {
    const series = seriesRemainder(name, brand);
    if (series) model = series;
  }
  let next = name;
  const color = canonicalColor(input.color);
  if (color && !includesLabel(next, color)) next = `${next} ${color}`.trim();
  const typeWord = canonicalType(typeHint);
  if (typeWord && !nameHasProductType(next)) next = `${next} ${typeWord}`.trim();
  if (model && !includesLabel(next, model)) model = null;
  return { name: clip(next), brand, model };
}

export function colorInText(text: string): string | null {
  let best: { to: string; length: number } | null = null;
  for (const [from, to] of COLORS) {
    if (!includesLabel(text, from)) continue;
    if (!best || from.length > best.length) best = { to, length: from.length };
  }
  return best?.to ?? null;
}

const GENERIC_TOKENS = new Set(['example', 'unknown', 'n/a', 'null', 'none', 'item', '例', '不明']);

function isGenericToken(token: string): boolean {
  return GENERIC_TOKENS.has(fold(token));
}

export function statedProductType(text: string): string | null {
  return bestTerm(text)?.canonical ?? null;
}

const PRODUCT_LINES: { token: string; label: string; category: string }[] = [
  { token: 'pixel', label: 'Pixel', category: 'スマートフォン' },
  { token: 'galaxy', label: 'Galaxy', category: 'スマートフォン' },
  { token: 'iphone', label: 'iPhone', category: 'スマートフォン' },
  { token: 'xperia', label: 'Xperia', category: 'スマートフォン' },
  { token: 'pavilion', label: 'Pavilion', category: 'ノートパソコン' },
];

export function deviceFormFactor(value: unknown): 'foldable' | 'bar' | null {
  if (value === 'foldable' || value === 'bar') return value;
  if (typeof value !== 'string') return null;
  const folded = fold(value);
  if (/fold|折りたたみ|フォールド/.test(folded)) return 'foldable';
  if (folded === 'bar' || /ストレート|直板/.test(folded)) return 'bar';
  return null;
}

export function productLine(text: string): { label: string; category: string } | null {
  const folded = fold(text);
  for (const line of PRODUCT_LINES) {
    const escaped = line.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(folded)) return line;
  }
  return null;
}

const DEVICE_CATEGORIES = new Set(['スマートフォン', 'ノートパソコン', 'ヘッドホン', 'ヘッドフォン', '腕時計']);

export function deviceCategory(text: string): string | null {
  const type = statedProductType(text);
  if (type && DEVICE_CATEGORIES.has(type)) return type;
  const line = productLine(text);
  if (line && DEVICE_CATEGORIES.has(line.category)) return line.category;
  return null;
}

export function searchLadderSteps(product: {
  name: string;
  brand: string | null;
  model: string | null;
  series?: string | null;
  formFactor?: 'foldable' | 'bar' | null;
}): { name: string; brand: string | null; model: string | null; jan: null }[] {
  const type = statedProductType(product.name);
  const color = colorInText(product.name);
  const cleaned = product.name.split(/ +/).filter((token) => token && !isGenericToken(token)).join(' ');
  const full = { name: cleaned || product.name.trim(), brand: product.brand, model: product.model, jan: null as null };
  const steps = cleaned ? [full] : [];
  const series = product.series?.trim() || productLine(product.name)?.label || null;
  const exactModel = Boolean(product.model && /\d/.test(product.model));
  if (!exactModel && product.formFactor === 'foldable' && product.brand && series) {
    steps.unshift({ name: `${product.brand} ${series} Fold`.replace(/\s+/g, ' ').trim(), brand: product.brand, model: null, jan: null });
  }
  if (product.brand && type) {
    steps.push({ name: `${product.brand} ${type}`, brand: product.brand, model: null, jan: null });
  }
  if (type && color) steps.push({ name: `${color} ${type}`, brand: null, model: null, jan: null });
  if (type) steps.push({ name: type, brand: null, model: null, jan: null });
  for (const step of steps) step.name = deviceQueryName(step.name);
  const seen = new Set<string>();
  const unique = [];
  for (const step of steps) {
    const key = storeSearchKeyword(step, { maxChars: 128, maxBytes: 128 });
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(step);
  }
  return unique;
}

function deviceQueryName(name: string): string {
  if (name.includes('本体') || /\bFold\b/i.test(name)) return name;
  if (!deviceCategory(name)) return name;
  return `${name} 本体`;
}

export function storeSearchKeyword(
  query: { name: string; brand: string | null; model: string | null },
  limit: { maxChars: number; maxBytes: number },
): string {
  const source = query.name.replace(/ +[-‐‑–—]+ +/g, ' ');
  const pieces = [source, query.brand ?? '', query.model ?? ''];
  const tokens: string[] = [];
  for (const piece of pieces) {
    for (const token of piece.split(/ +/)) {
      const cleaned = token.trim();
      if (!cleaned || /^[-‐‑–—]+$/.test(cleaned) || isGenericToken(cleaned)) continue;
      const covered = tokens.join(' ');
      if (covered && tokenCovered(covered, cleaned)) continue;
      tokens.push(cleaned);
    }
  }
  let result = '';
  for (const token of tokens) {
    const next = result ? `${result} ${token}` : token;
    if (result && !withinLimit(next, limit)) break;
    result = next;
  }
  if (!withinLimit(result, limit)) result = trimToLimit(result, limit);
  return result.trim();
}

function tokenCovered(haystack: string, token: string): boolean {
  const needle = fold(token);
  if (!needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/[a-z0-9]/i.test(needle)) {
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(fold(haystack));
  }
  return fold(haystack).includes(needle);
}

function withinLimit(value: string, limit: { maxChars: number; maxBytes: number }): boolean {
  return [...value].length <= limit.maxChars && Buffer.byteLength(value, 'utf8') <= limit.maxBytes;
}

function trimToLimit(value: string, limit: { maxChars: number; maxBytes: number }): string {
  let chars = [...value].slice(0, limit.maxChars).join('');
  while (chars && Buffer.byteLength(chars, 'utf8') > limit.maxBytes) chars = [...chars].slice(0, -1).join('');
  return chars.trim();
}

export function guessIsSpecific(product: { name: string; brand: string | null; model: string | null }): boolean {
  if (product.brand && product.model) return true;
  return Boolean(product.brand) && nameHasProductType(product.name);
}

function primaryGroup(text: string): string | null {
  return bestTerm(text)?.group ?? null;
}

export function dropOtherCategories<T extends { title: string }>(items: readonly T[], queryName: string): T[] {
  if (!statedProductType(queryName)) return [...items];
  return items.filter((item) => !categoryMismatch(queryName, item.title));
}

export function categoryMismatch(queryName: string, title: string): boolean {
  const wanted = primaryGroup(queryName);
  if (!wanted) return false;
  if (primaryGroup(title) === null) return false;
  return !titleMatchesGroup(title, wanted);
}

function titleMatchesGroup(title: string, group: string): boolean {
  return TERMS.some((entry) => entry.group === group && includesTerm(title, entry.term));
}

export function shorterQueryKeepingType(name: string, model: string | null): string | null {
  const token = model?.trim() ?? '';
  if (!token || !nameHasProductType(name) || isOnlyType(token)) return null;
  if (!includesLabel(name, token)) return null;
  const foldedName = fold(name);
  const foldedToken = fold(token);
  const index = foldedName.indexOf(foldedToken);
  if (index < 0) return null;
  const removed = `${name.slice(0, index)} ${name.slice(index + token.length)}`.replace(/\s+/g, ' ').trim();
  if (!removed || removed === name || !nameHasProductType(removed)) return null;
  return removed;
}
