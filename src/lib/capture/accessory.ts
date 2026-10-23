// 写真の商品名から Yahoo! のジャンルIDや、本体らしい価格の下限は決められない。
// 安いケースが上に来るので、価格では絞らない。店への検索は1回だけで、やり直しはしない。
// 除外は1回のクエリに載せ、返った候補に本体が残るときだけ付属品を落とす。
// 本体が一件も無いときは、取れた候補をそのまま出す。
// 「対応」「用」「保護」「ガラス」は本体の商品名にも出る。
// 検索語の除外には入れず、並びの点数にだけ使う。候補を落とすのは強い付属品の名詞と、
// 「【機種用】」のような括弧だけ。「【家庭用】」「【業務用】」「【一般用】」は本体なので残す。

const STRONG_ACCESSORY_TERMS = ['ケース', 'カバー', 'フィルム', '充電器', 'ケーブル', 'ストラップ'] as const;
const WEAK_ACCESSORY_TERMS = ['保護', 'ガラス', '対応', '用'] as const;
const BRACKET_FOR_MODEL = /【(?!家庭用】|業務用】|一般用】)[^】\n]{1,40}用】/;

export type AccessoryQuery = {
  name: string;
  brand?: string | null;
  model?: string | null;
};

export function queryWantsAccessory(parts: readonly string[]): boolean {
  const text = parts.join(' ');
  return [...STRONG_ACCESSORY_TERMS, ...WEAK_ACCESSORY_TERMS].some((term) => text.includes(term));
}

export function preferMainProduct(query: AccessoryQuery, janValid: boolean): boolean {
  if (janValid) return false;
  return !queryWantsAccessory([query.name, query.brand ?? '', query.model ?? '']);
}

export function accessoryScore(title: string): number {
  let score = 0;
  for (const term of STRONG_ACCESSORY_TERMS) if (title.includes(term)) score += 2;
  for (const term of WEAK_ACCESSORY_TERMS) if (title.includes(term)) score += 1;
  return score;
}

export function accessoryListing(title: string): boolean {
  if (STRONG_ACCESSORY_TERMS.some((term) => title.includes(term))) return true;
  return BRACKET_FOR_MODEL.test(title);
}

export function preferMainProducts<T extends { title: string }>(items: readonly T[], prefer: boolean): T[] {
  if (!prefer) return [...items];
  const main = items.filter((item) => !accessoryListing(item.title));
  return main.length > 0 ? main : [...items];
}

export function yahooQueryWithExclusions(keyword: string, prefer: boolean): string {
  const trimmed = keyword.trim();
  if (!trimmed) return '';
  if (!prefer) return trimmed.slice(0, 400);
  const suffix = STRONG_ACCESSORY_TERMS.map((term) => ` -${term}`).join('');
  const base = trimmed.slice(0, Math.max(0, 400 - suffix.length)).trimEnd();
  if (!base) return trimmed.slice(0, 400);
  return `${base}${suffix}`;
}

export function rakutenNgKeyword(prefer: boolean): string | null {
  if (!prefer) return null;
  return STRONG_ACCESSORY_TERMS.join(' ');
}
