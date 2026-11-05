/** 価格更新バッジ用。ボット制限と一般失敗を短く区別する（#368）。 */
export function scrapeFailureCaption(
  scrapeError: string | null | undefined,
  source?: string | null,
): string {
  const err = scrapeError || '';
  if (
    source === 'amazon' ||
    source === 'rakuten' ||
    /ボット|待機ページ|自動取得が制限/.test(err)
  ) {
    return '自動取得が制限されています';
  }
  return '価格を更新できていません';
}
