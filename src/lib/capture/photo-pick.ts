// 「写真を選ぶ」で受け取る1枚を、縮小してから送る。元の写真は保存しない。
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, sniffImage } from './contract';
import { preparePhotoUpload, type ShrinkDeps } from './photo-client';

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']);
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/octet-stream']);

export function showPhotoPicker(flags: { enabled?: boolean } | null, isGuest: boolean): boolean {
  return flags?.enabled === true && !isGuest;
}

export type CapturePhotoAction = 'camera' | 'file';

export function capturePhotoActions(input: { coarsePointer: boolean; camera: boolean }): CapturePhotoAction[] | 'sheet' {
  if (input.coarsePointer) return 'sheet';
  return input.camera ? ['camera', 'file'] : ['file'];
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

export async function photoForUpload(files: readonly File[], deps?: ShrinkDeps): Promise<PhotoPick> {
  const picked = await classifyPickedPhotos(files);
  if (picked.ok) return finishPhotoUpload(picked.file, deps);
  if (picked.ignored || files.length !== 1 || picked.message !== CaptureMessages.photoUnreadable) return picked;
  const file = files[0];
  if (!(await fileLooksLikeHeic(file))) return picked;
  const prepared = await finishPhotoUpload(file, deps);
  if (prepared.ok) return prepared;
  if (!prepared.ignored && prepared.message === CaptureMessages.photoTooLarge) return prepared;
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (sniffImage(header) !== 'heif') return prepared;
  if (file.size > CAPTURE_PHOTO_MAX_BYTES) {
    return { ok: false, ignored: false, message: CaptureMessages.photoTooLarge };
  }
  return { ok: true, file };
}

async function finishPhotoUpload(file: File, deps?: ShrinkDeps): Promise<PhotoPick> {
  const prepared = await preparePhotoUpload(file, deps);
  if (!prepared.ok) return { ok: false, ignored: false, message: prepared.error.error };
  return { ok: true, file: prepared.value.file };
}

async function fileLooksLikeHeic(file: File): Promise<boolean> {
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (HEIC_TYPES.has(declared)) return true;
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return sniffImage(header) === 'heif';
}
