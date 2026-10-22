import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages } from '../src/lib/capture/contract';
import type { ShrinkDeps, ShrinkSource } from '../src/lib/capture/photo-client';

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const heic = Uint8Array.of(0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0);
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function source(width: number, height: number, closed: { value: boolean } = { value: false }): ShrinkSource {
  return {
    width,
    height,
    source: null as unknown as CanvasImageSource,
    close() {
      closed.value = true;
    },
  };
}

function countingDeps(encode: (width: number, height: number, quality: number) => Blob, calls: { decode: number }): ShrinkDeps {
  return {
    async decode() {
      calls.decode += 1;
      return source(4000, 3000);
    },
    async encodeJpeg(_decoded, width, height, quality) {
      return encode(width, height, quality);
    },
  };
}

test('the upload path shrinks a chosen photo before sending it', async () => {
  const { photoForUpload } = await import('../src/lib/capture/photo-pick');
  const original = new File([png], 'shot.png', { type: 'image/png' });
  const encoded = Uint8Array.of(0xff, 0xd8, 0xff, 0x10);
  const calls = { decode: 0 };
  let seen: { width: number; height: number; quality: number } | null = null;
  const result = await photoForUpload([original], countingDeps((width, height, quality) => {
    seen = { width, height, quality };
    return new Blob([encoded], { type: 'image/jpeg' });
  }, calls));
  assert.equal(calls.decode, 1);
  assert.deepEqual(seen, { width: 1600, height: 1200, quality: 0.8 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.file.type, 'image/jpeg');
  assert.equal(result.file.name.endsWith('.jpg'), true);
  assert.equal(result.file.size, encoded.byteLength);
  assert.equal(result.file.size <= CAPTURE_PHOTO_MAX_BYTES, true);
  assert.equal(Buffer.from(await result.file.arrayBuffer()).equals(Buffer.from(encoded)), true);
  assert.equal(Buffer.from(await result.file.arrayBuffer()).equals(Buffer.from(png)), false);
});

test('the upload path rejects a jpeg that is still over 5MB and accepts exactly 5MB', async () => {
  const { photoForUpload } = await import('../src/lib/capture/photo-pick');
  const original = new File([png], 'big.png', { type: 'image/png' });
  const over = await photoForUpload([original], {
    async decode() {
      return source(200, 100);
    },
    async encodeJpeg() {
      return new Blob([new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1)], { type: 'image/jpeg' });
    },
  });
  assert.equal(over.ok, false);
  if (!over.ok && !over.ignored) assert.equal(over.message, CaptureMessages.photoTooLarge);

  const exact = await photoForUpload([original], {
    async decode() {
      return source(200, 100);
    },
    async encodeJpeg() {
      return new Blob([new Uint8Array(CAPTURE_PHOTO_MAX_BYTES)], { type: 'image/jpeg' });
    },
  });
  assert.equal(exact.ok, true);
  if (exact.ok) assert.equal(exact.file.size, CAPTURE_PHOTO_MAX_BYTES);
});

test('a photo the browser cannot decode keeps the existing unreadable message', async () => {
  const { photoForUpload } = await import('../src/lib/capture/photo-pick');
  const original = new File([png], 'broken.png', { type: 'image/png' });
  const result = await photoForUpload([original], {
    async decode() {
      throw new Error('canvas decode failed');
    },
    async encodeJpeg() {
      throw new Error('unused');
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok && !result.ignored) assert.equal(result.message, CaptureMessages.photoUnreadable);
});

test('HEIC is shrunk when the browser can decode it, and stays unreadable when it cannot', async () => {
  const { photoForUpload } = await import('../src/lib/capture/photo-pick');
  const original = new File([heic], 'library.heic', { type: 'image/heic' });
  let decoded = 0;
  const unreadable = await photoForUpload([original], {
    async decode() {
      decoded += 1;
      throw new Error('heic unsupported');
    },
    async encodeJpeg() {
      return new Blob([jpeg], { type: 'image/jpeg' });
    },
  });
  assert.equal(decoded, 1);
  assert.equal(unreadable.ok, false);
  if (!unreadable.ok && !unreadable.ignored) assert.equal(unreadable.message, CaptureMessages.photoUnreadable);

  const encoded = Uint8Array.of(0xff, 0xd8, 0xff, 0x22);
  const readable = await photoForUpload([original], {
    async decode() {
      return source(4032, 3024);
    },
    async encodeJpeg(_decoded, width, height, quality) {
      assert.equal(width, 1600);
      assert.equal(height, 1200);
      assert.equal(quality, 0.8);
      return new Blob([encoded], { type: 'image/jpeg' });
    },
  });
  assert.equal(readable.ok, true);
  if (!readable.ok) return;
  assert.equal(readable.file.type, 'image/jpeg');
  assert.equal(Buffer.from(await readable.file.arrayBuffer()).equals(Buffer.from(heic)), false);
});

test('gif and multiple files do not go through shrink', async () => {
  const { photoForUpload } = await import('../src/lib/capture/photo-pick');
  let decoded = 0;
  const deps: ShrinkDeps = {
    async decode() {
      decoded += 1;
      return source(10, 10);
    },
    async encodeJpeg() {
      return new Blob([jpeg], { type: 'image/jpeg' });
    },
  };
  const gifPick = await photoForUpload([new File([gif], 'a.gif', { type: 'image/gif' })], deps);
  assert.equal(gifPick.ok, false);
  if (!gifPick.ok && !gifPick.ignored) assert.equal(gifPick.message, CaptureMessages.photoUnreadable);
  const two = await photoForUpload([
    new File([png], 'a.png', { type: 'image/png' }),
    new File([png], 'b.png', { type: 'image/png' }),
  ], deps);
  assert.equal(two.ok, false);
  if (!two.ok && !two.ignored) assert.equal(two.message, CaptureMessages.onePhoto);
  const none = await photoForUpload([], deps);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.ignored, true);
  assert.equal(decoded, 0);
});

test('撮る, 写真を選ぶ, and drop all go through photoForUpload', () => {
  const sourceText = readFileSync(new URL('../src/components/CapturePhotoPicker.tsx', import.meta.url), 'utf8');
  assert.equal(sourceText.includes('upload: typeof photoForUpload = photoForUpload'), true);
  assert.equal(sourceText.includes('void upload(files)'), true);
  assert.equal(sourceText.split('onChange={onChange}').length - 1, 2);
  assert.equal(sourceText.includes('acceptFiles([...event.dataTransfer.files])'), true);
});

function pngSize(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpegSize(width: number, height: number, orientation?: number): Uint8Array {
  const sof = Uint8Array.of(
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  );
  if (!orientation) return Uint8Array.of(0xff, 0xd8, ...sof, 0xff, 0xd9);
  const tiff = Uint8Array.of(
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00,
    orientation & 0xff, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  );
  const payload = Uint8Array.of(...Buffer.from('Exif\0\0'), ...tiff);
  const length = payload.length + 2;
  const app1 = Uint8Array.of(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  return Uint8Array.of(0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9);
}

test('decode options stay inside the iOS and Android canvas limit', async () => {
  const { bitmapOptionsForImage, CAPTURE_CANVAS_MAX_EDGE, orientedImageSize } = await import('../src/lib/capture/photo-client');
  assert.equal(CAPTURE_CANVAS_MAX_EDGE, 4096);
  const small = bitmapOptionsForImage(800, 600);
  assert.equal(small.imageOrientation, 'from-image');
  assert.equal(small.resizeWidth, undefined);
  assert.equal(small.resizeHeight, undefined);

  const huge = bitmapOptionsForImage(8000, 6000);
  assert.equal(huge.resizeWidth, 1600);
  assert.equal(huge.resizeHeight, 1200);
  assert.ok((huge.resizeWidth ?? 0) <= CAPTURE_CANVAS_MAX_EDGE);
  assert.ok((huge.resizeHeight ?? 0) <= CAPTURE_CANVAS_MAX_EDGE);
  assert.ok((huge.resizeWidth ?? 0) * (huge.resizeHeight ?? 0) <= CAPTURE_CANVAS_MAX_EDGE * CAPTURE_CANVAS_MAX_EDGE);

  const unknown = bitmapOptionsForImage(0, 0);
  assert.equal(unknown.resizeWidth, undefined);

  assert.deepEqual(orientedImageSize(pngSize(4000, 3000)), { width: 4000, height: 3000 });
  assert.deepEqual(orientedImageSize(jpegSize(32, 16)), { width: 32, height: 16 });
  assert.deepEqual(orientedImageSize(jpegSize(4032, 3024, 6)), { width: 3024, height: 4032 });
  assert.equal(orientedImageSize(Uint8Array.of(1, 2, 3, 4)), null);
});

test('capture docs name the dev origin env and the pre-upload shrink errors', () => {
  const doc = readFileSync(new URL('../docs/capture.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  for (const phrase of [
    'DEV_ALLOWED_ORIGINS',
    'tailscale serve',
    '長辺1600px',
    '写真は5MBまでです',
    'この写真は読めません',
    'iPhone Safari',
    'Android Chrome',
  ]) {
    assert.equal(doc.includes(phrase), true, phrase);
  }
  assert.equal(/[0-9a-f]{32}/.test(doc), false);
  assert.equal(changelog.includes('送る前にブラウザで長辺1600pxの JPEG に縮小'), true);
});
