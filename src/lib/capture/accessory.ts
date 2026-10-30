// 写真の商品名から Yahoo! のジャンルIDや、本体らしい価格の下限は決められない。
// 安いケースが上に来るので、価格では絞らない。付属品を落とすための再検索はしない。
// 検索語へ `-ケース` を足すと、「充電ケース付き」のように本体の名前まで店の結果から消える。
// その除外は候補が返る前に起きるので、本体が一件も無いときの戻しが効かない。
// クエリと楽天の NGKeyword には除外語を足さない。
// 返った候補から落とすのは強い付属品の名詞だけ。本体が一件も無いときは、取れた候補をそのまま出す。
// 「対応」「用」「保護」「ガラス」と、「【機種用】」のような括弧は本体の商品名にも出る。
// それだけでは候補を落とさず、並びの点数にだけ使う。
// 本体が消える誤除外は、付属品が後ろに残るより悪い。

const STRONG_ACCESSORY_TERMS = ['ケース', 'カバー', 'フィルム', '充電器', 'ケーブル', 'ストラップ', 'バッテリー', '電池', 'アダプター', 'アダプタ', '互換'] as const;
const WEAK_ACCESSORY_TERMS = ['保護', 'ガラス', '対応', '用'] as const;

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
  return STRONG_ACCESSORY_TERMS.some((term) => title.includes(term));
}

export function preferMainProducts<T extends { title: string }>(items: readonly T[], prefer: boolean): T[] {
  if (!prefer) return [...items];
  const main = items.filter((item) => !accessoryListing(item.title));
  return main.length > 0 ? main : [...items];
}
