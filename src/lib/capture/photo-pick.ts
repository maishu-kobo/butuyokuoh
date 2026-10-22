// 「写真を選ぶ」で受け取る1枚を、送る前に振り分ける。元の写真は保存しない。
import { CaptureMessages, sniffImage } from './contract';

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream']);

export function showPhotoPicker(flags: { enabled?: boolean } | null, isGuest: boolean): boolean {
  return flags?.enabled === true && !isGuest;
}

export type PhotoPick =
  | { ok: true; file: File }
  | { ok: false; ignored: true }
  | { ok: false; ignored: false; message: string };

export async function classifyPickedPhotos(files: readonly File[]): Promise<PhotoPick> {
  if (files.length === 0) return { ok: false, ignored: true };
  if (files.length !== 1) return { ok: false, ignored: false, message: CaptureMessages.onePhoto };
  const file = files[0];
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (HEIC_TYPES.has(declared)) return { ok: false, ignored: false, message: CaptureMessages.photoUnreadable };
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const sniffed = sniffImage(header);
  if (sniffed === 'heif' || sniffed === null) return { ok: false, ignored: false, message: CaptureMessages.photoUnreadable };
  if (declared && !ALLOWED_TYPES.has(declared)) return { ok: false, ignored: false, message: CaptureMessages.photoUnreadable };
  return { ok: true, file };
}
