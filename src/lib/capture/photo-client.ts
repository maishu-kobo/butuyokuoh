// ブラウザで長辺1600pxの JPEG にしてから送る。元の写真は返さない。
import { CaptureMessages, captureFailure, type CaptureResult } from './contract';

export const CAPTURE_PHOTO_MAX_EDGE = 1600;
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

function browserShrinkDeps(): ShrinkDeps {
  return {
    async decode(file) {
      const bitmap = await createImageBitmap(file, CAPTURE_BITMAP_OPTIONS);
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
