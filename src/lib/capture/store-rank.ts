// 店が返した順を、価格より先のタイブレークにする。
// 付属品の追加語と、ヘッドホンに対するイヤホンは並びの点数だけ。検索語からは引かない。
// 順位は列挙されない印なので、画面のJSONには出ない。受け付け直しでも同じ印を残す。

const STORE_RANK = Symbol.for('butuyokuoh.capture.storeRank');
const STORE_RANK_MISSING = 100_000;

// 本体の強い付属品語に、交換部品と英語の kit を足す。クエリ自身がその語を含むときは足さない。
const EXTRA_ACCESSORY = /(ケース|カバー|フィルム|充電器|ケーブル|ストラップ|イヤーパッド|イヤークッション|交換用|交換|互換|バッテリー|替え|部品|パーツ|リペア|修理|\bcase\b|\bcushion|\bcover\b|\bbattery\b|\breplacement\b|\bparts?\b|\bkit\b)/i;

const OVER_EAR = /ヘッドホン|ヘッドフォン|headphones?|over-?ear/i;
const EARBUD = /イヤホン|イヤフォン|earbuds?|earphones?/i;
const EAR_PAD = /イヤーパッド|イヤークッション|earpads?|ear\s*cushions?|ear\s*pads?/i;

export function readStoreRank(item: object): number | null {
  const value = (item as { [STORE_RANK]?: unknown })[STORE_RANK];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= STORE_RANK_MISSING) return null;
  return value;
}

export function writeStoreRank(item: object, rank: number): void {
  Object.defineProperty(item, STORE_RANK, { value: rank, enumerable: false, writable: false, configurable: true });
}

export function copyStoreRank(from: object, to: object): void {
  const rank = readStoreRank(from);
  if (rank != null) writeStoreRank(to, rank);
}

// すでに順位がある候補は上書きしない。検索をやり直しても店の最初の順が残る。
export function rememberStoreOrder(items: readonly object[]): void {
  items.forEach((item, index) => {
    if (readStoreRank(item) == null) writeStoreRank(item, index);
  });
}

export function storeRankKey(item: object): number {
  return readStoreRank(item) ?? STORE_RANK_MISSING;
}

export function extraAccessoryPenalty(queryText: string, title: string): number {
  if (EXTRA_ACCESSORY.test(queryText)) return 0;
  return EXTRA_ACCESSORY.test(title) ? 2 : 0;
}

// ヘッドホンの推定で、イヤホンとイヤーパッドを本体より前に出さない。逆も同じ。
export function audioFormPenalty(queryText: string, title: string): number {
  const wantsBud = EARBUD.test(queryText);
  const wantsOver = OVER_EAR.test(queryText);
  const wantsPad = EAR_PAD.test(queryText);
  if (wantsOver && !wantsBud && !wantsPad) {
    if (EARBUD.test(title) || EAR_PAD.test(title)) return 1;
  }
  if (wantsBud && !wantsOver) {
    if (OVER_EAR.test(title) && !EARBUD.test(title)) return 1;
  }
  return 0;
}
