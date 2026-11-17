import { amazonUsdFallbackNoteText } from './amazon-product';
import { CONFIGURATOR_PRICE_NOTE, PRICE_LATER_NOTE } from './scraper';

/** 価格更新バッジ用。ボット制限と一般失敗を短く区別する（#368・#408・#415）。 */
export function scrapeFailureCaption(
  scrapeError: string | null | undefined,
  _source?: string | null,
  options?: { forGuest?: boolean },
): string {
  const err = scrapeError || '';
  // source=amazon/rakuten だけでは付けない。USD フォールバックや価格欠落まで
  // 「サイト側制限」に見せない（#408 Bugbot）。エラー文がブロックを示すときだけ。
  if (/ボット|待機ページ|自動取得が制限|取得を制限/.test(err)) {
    // 「ゲストが禁止」ではなく、販売サイト側の制限だと分かる短い文言にする。
    return options?.forGuest
      ? '販売サイト側の制限（ゲストは簡易取得）'
      : '販売サイト側で自動取得が制限されています';
  }
  if (err === CONFIGURATOR_PRICE_NOTE || err.startsWith('構成を選ぶページ')) {
    return '構成ページのため価格未取得';
  }
  if (err === PRICE_LATER_NOTE || err.startsWith('価格は取得できませんでした')) {
    return '価格を取得できませんでした';
  }
  if (amazonUsdFallbackNoteText(err)) {
    return '円の新品価格を取得できませんでした';
  }
  return '価格を更新できていません';
}
