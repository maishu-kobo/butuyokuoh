// ファイル名は商品情報ではない。利用者が明示的に選ぶ検索の補助だけに使う。
export function filenameProductCode(filename: string): string | null {
  if (filename.length > 100 || /[\/\\]/.test(filename)) return null;
  const stem = filename.replace(/\.(?:jpe?g|png|heic|heif)$/i, '');
  if (stem === filename || /^(?:IMG|IMAGE|PHOTO|PXL|DSC|DSCN|DSCF|DCIM|SCREENSHOT)[_-]?/i.test(stem)) return null;
  if (/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(stem)) return null;
  if (/^\d{8}T\d{6}(?:\d{1,3})?Z?$/i.test(stem)) return null;
  const code = stem.replace(/_(?:[a-z]|front|back|side)$/i, '').toUpperCase();
  if (!/^[A-Z0-9-]{8,40}$/.test(code)) return null;
  if ((code.match(/[A-Z]/g) ?? []).length < 2 || (code.match(/\d/g) ?? []).length < 3) return null;
  return code;
}
