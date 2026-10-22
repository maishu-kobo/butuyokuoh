// 暦日。timeZone を省略すると実行環境のタイムゾーン。toISOString() は UTC なので、日本の 0:00〜8:59 は前日になる。
export function localCalendarDate(now = new Date(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
