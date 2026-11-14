/** 価格更新バッジ用。ボット制限と一般失敗を短く区別する（#368・#408）。 */
export function scrapeFailureCaption(
  scrapeError: string | null | undefined,
  source?: string | null,
  options?: { forGuest?: boolean },
): string {
  const err = scrapeError || '';
  if (
    source === 'amazon' ||
    source === 'rakuten' ||
    /ボット|待機ページ|自動取得が制限|取得を制限/.test(err)
  ) {
    // 「ゲストが禁止」ではなく、販売サイト側の制限だと分かる短い文言にする。
    return options?.forGuest
      ? '販売サイト側の制限（ゲストは簡易取得）'
      : '販売サイト側で自動取得が制限されています';
  }
  return '価格を更新できていません';
}
