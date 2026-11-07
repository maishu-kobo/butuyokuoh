// サーバが変換した JPEG のプレビュー。保存しない。data URL 以外は画面に出さない。
const PREVIEW_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const PREVIEW_MAX_CHARS = 80_000;

export function capturePreviewSrc(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 32 || value.length > PREVIEW_MAX_CHARS) return null;
  if (!PREVIEW_URL.test(value)) return null;
  return value;
}

export function serverPhotoPreview(fileType: string, preview: unknown): string | null {
  if (fileType === 'image/jpeg' || fileType === 'image/png' || fileType === 'image/webp') return null;
  return capturePreviewSrc(preview);
}
