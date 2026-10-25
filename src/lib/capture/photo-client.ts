// ブラウザで長辺1600pxの JPEG にしてから送る。元の写真は返さない。
// 描くキャンバスは iOS Safari と Android Chrome の辺 4096 より小さくする。
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, captureFailure, type CaptureResult } from './contract';

export const CAPTURE_PHOTO_MAX_EDGE = 1600;
export const CAPTURE_CANVAS_MAX_EDGE = 4096;
export const CAPTURE_CANVAS_MAX_AREA = CAPTURE_CANVAS_MAX_EDGE * CAPTURE_CANVAS_MAX_EDGE;
export const CAPTURE_JPEG_QUALITY = 0.8;
export const CAPTURE_BITMAP_OPTIONS = { imageOrientation: 'from-image' } as const;

export function fitPhotoEdge(width: number, height: number, maxEdge = CAPTURE_PHOTO_MAX_EDGE): { width: number; height: number } {
  const edge = Math.max(width, height);
  if (edge <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function bitmapOptionsForImage(width: number, height: number): ImageBitmapOptions {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return options;
  const overTarget = width > CAPTURE_PHOTO_MAX_EDGE || height > CAPTURE_PHOTO_MAX_EDGE;
  const overCanvas = width > CAPTURE_CANVAS_MAX_EDGE || height > CAPTURE_CANVAS_MAX_EDGE || width * height > CAPTURE_CANVAS_MAX_AREA;
  if (!overTarget && !overCanvas) return options;
  const fitted = fitPhotoEdge(width, height);
  options.resizeWidth = fitted.width;
  options.resizeHeight = fitted.height;
  options.resizeQuality = 'high';
  return options;
}

export function orientedImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  return pngOrientedSize(bytes) ?? jpegOrientedSize(bytes);
}

export type ShrinkSource = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
};

export type ShrinkDeps = {
  decode(file: Blob): Promise<ShrinkSource>;
  encodeJpeg(decoded: ShrinkSource, width: number, height: number, quality: number): Promise<Blob>;
};

export async function shrinkPhotoForUpload(file: Blob, deps: ShrinkDeps = browserShrinkDeps()): Promise<CaptureResult<{ blob: Blob }>> {
  let decoded: ShrinkSource | null = null;
  try {
    decoded = await deps.decode(file);
    const size = fitPhotoEdge(decoded.width, decoded.height);
    const blob = await deps.encodeJpeg(decoded, size.width, size.height, CAPTURE_JPEG_QUALITY);
    if (blob === file || blob.type !== 'image/jpeg') {
      return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
    }
    return { ok: true, value: { blob } };
  } catch {
    return captureFailure('PHOTO_UNREADABLE', CaptureMessages.photoUnreadable, 400);
  } finally {
    decoded?.close();
  }
}

export async function preparePhotoUpload(
  file: Blob,
  deps: ShrinkDeps = browserShrinkDeps(),
): Promise<CaptureResult<{ file: File }>> {
  const shrunk = await shrinkPhotoForUpload(file, deps);
  if (!shrunk.ok) return shrunk;
  if (shrunk.value.blob.size > CAPTURE_PHOTO_MAX_BYTES) {
    return captureFailure('PHOTO_TOO_LARGE', CaptureMessages.photoTooLarge, 413);
  }
  return {
    ok: true,
    value: { file: new File([shrunk.value.blob], jpegUploadName(file), { type: 'image/jpeg' }) },
  };
}

function jpegUploadName(file: Blob): string {
  const raw = file instanceof File ? file.name : '';
  const baseName = raw.split(/[/\\]/).pop() ?? '';
  const base = baseName.replace(/\.[^./\\]+$/, '').trim();
  return `${base || 'photo'}.jpg`;
}

function browserShrinkDeps(): ShrinkDeps {
  return {
    async decode(file) {
      const header = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
      const hinted = orientedImageSize(header);
      const options = bitmapOptionsForImage(hinted?.width ?? 0, hinted?.height ?? 0);
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file, options);
      } catch (error) {
        if (options.resizeWidth === undefined) throw error;
        bitmap = await createImageBitmap(file, CAPTURE_BITMAP_OPTIONS);
      }
      bitmap = await clampBitmapToCanvas(bitmap);
      return {
        width: bitmap.width,
        height: bitmap.height,
        source: bitmap,
        close() {
          bitmap.close();
        },
      };
    },
    async encodeJpeg(decoded, width, height, quality) {
      const sourceArea = decoded.width * decoded.height;
      if (
        width < 1 || height < 1 ||
        width > CAPTURE_CANVAS_MAX_EDGE || height > CAPTURE_CANVAS_MAX_EDGE ||
        width * height > CAPTURE_CANVAS_MAX_AREA ||
        decoded.width > CAPTURE_CANVAS_MAX_EDGE || decoded.height > CAPTURE_CANVAS_MAX_EDGE ||
        sourceArea > CAPTURE_CANVAS_MAX_AREA
      ) {
        throw new Error('canvas limit');
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      context.drawImage(decoded.source, 0, 0, width, height);
      const blob = await new Promise<Blob | null>(resolve => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      });
      if (!blob) throw new Error('jpeg encode failed');
      return blob;
    },
  };
}

async function clampBitmapToCanvas(bitmap: ImageBitmap): Promise<ImageBitmap> {
  let current = bitmap;
  try {
    for (let step = 0; step < 8; step += 1) {
      const width = current.width;
      const height = current.height;
      const overEdge = width > CAPTURE_CANVAS_MAX_EDGE || height > CAPTURE_CANVAS_MAX_EDGE;
      const overArea = width * height > CAPTURE_CANVAS_MAX_AREA;
      if (!overEdge && !overArea) return current;
      const fitted = fitPhotoEdge(width, height);
      const next = await createImageBitmap(current, {
        resizeWidth: fitted.width,
        resizeHeight: fitted.height,
        resizeQuality: 'medium',
      });
      current.close();
      current = next;
      if (width === next.width && height === next.height) throw new Error('canvas limit');
    }
    throw new Error('canvas limit');
  } catch (error) {
    current.close();
    throw error;
  }
}

function pngOrientedSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (ascii(bytes, 12, 16) !== 'IHDR') return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function jpegOrientedSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker === 0xe1) {
      const found = exifOrientation(bytes.subarray(offset + 2, offset + length));
      if (found) orientation = found;
    }
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7) return null;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      if (width < 1 || height < 1) return null;
      const swap = orientation >= 5 && orientation <= 8;
      return swap ? { width: height, height: width } : { width, height };
    }
    offset += length;
  }
  return null;
}

function exifOrientation(segment: Uint8Array): number | null {
  if (segment.length < 16 || ascii(segment, 0, 4) !== 'Exif') return null;
  const tiff = 6;
  const little = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49;
  const big = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (pos: number) => {
    const left = segment[tiff + pos];
    const right = segment[tiff + pos + 1];
    if (left === undefined || right === undefined) return 0;
    return little ? (right << 8) | left : (left << 8) | right;
  };
  const u32 = (pos: number) => {
    const bytes = [0, 1, 2, 3].map((index) => segment[tiff + pos + index] ?? 0);
    if (little) return ((bytes[3] << 24) | (bytes[2] << 16) | (bytes[1] << 8) | bytes[0]) >>> 0;
    return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  };
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd < 8 || tiff + ifd + 2 > segment.length) return null;
  const count = u16(ifd);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (tiff + entry + 12 > segment.length) return null;
    if (u16(entry) !== 0x0112) continue;
    const value = u16(entry + 8);
    return value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = '';
  for (let index = start; index < end && index < bytes.length; index += 1) text += String.fromCharCode(bytes[index] ?? 0);
  return text;
}
