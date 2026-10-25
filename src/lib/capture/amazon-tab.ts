type SearchClick = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  preventDefault(): void;
};

// クリックの直後に新しいタブを開く。iPhone Safari は target=_blank を無視して
// 同じタブへ進むことがある。参照元は今の noreferrer のまま送らない。
// 修飾キーと中ボタンはブラウザのままにする。
export function openAmazonSearchTab(
  event: SearchClick,
  href: string,
  open: typeof window.open = window.open,
): void {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  open(href, '_blank', 'noopener,noreferrer');
  event.preventDefault();
}
