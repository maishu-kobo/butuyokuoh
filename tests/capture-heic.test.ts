import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, decodeCapturePhoto, sniffImage } from '../src/lib/capture/contract';
import { prepareCapturePhoto } from '../src/lib/capture/photo';
import { photoForUpload } from '../src/lib/capture/photo-pick';
import type { ShrinkDeps } from '../src/lib/capture/photo-client';

const heic = new Uint8Array(readFileSync(new URL('./fixtures/tiny-hevc.heic', import.meta.url)));
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x22);

const cannotDecode: ShrinkDeps = {
  async decode() {
    throw new Error('heic unsupported');
  },
  async encodeJpeg() {
    return new Blob([jpeg], { type: 'image/jpeg' });
  },
};

test('a real HEVC HEIC is re-encoded to JPEG before the model can see it', async () => {
  assert.equal(sniffImage(heic), 'heif');
  const prepared = await prepareCapturePhoto(heic, 'image/heic');
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.value.mediaType, 'image/jpeg');
  assert.equal(sniffImage(prepared.value.bytes), 'image/jpeg');
  const meta = await sharp(prepared.value.bytes).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 32);
  assert.equal(meta.height, 24);
  assert.equal(meta.exif, undefined);
});

test('the file picker lists HEIC and HEIF so a desktop dialog can choose them', () => {
  const picker = readFileSync(new URL('../src/components/CapturePhotoPicker.tsx', import.meta.url), 'utf8');
  const fileInput = picker.slice(0, picker.indexOf('aria-label="写真ファイル"'));
  const accept = [...fileInput.matchAll(/accept="([^"]+)"/g)].at(-1);
  assert.ok(accept, 'file input accept');
  const value = accept?.[1] ?? '';
  for (const token of ['image/heic', 'image/heif', '.heic', '.heif']) {
    assert.equal(value.split(',').includes(token), true, token);
  }
});

test('when the browser cannot decode HEIC the original is uploaded for the server', async () => {
  const original = new File([heic], 'library.heic', { type: 'image/heic' });
  const result = await photoForUpload([original], cannotDecode);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.file.type, 'image/heic');
  assert.equal(Buffer.from(await result.file.arrayBuffer()).equals(Buffer.from(heic)), true);
});

test('an HEIC larger than the cap is not uploaded when the browser cannot shrink it', async () => {
  const huge = new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1);
  huge.set(heic.subarray(0, 32));
  const result = await photoForUpload([new File([huge], 'big.heic', { type: 'image/heic' })], cannotDecode);
  assert.equal(result.ok, false);
  if (!result.ok && !result.ignored) assert.equal(result.message, CaptureMessages.photoTooLarge);
});

test('decodeCapturePhoto still refuses HEIC so the model is only given JPEG', () => {
  const result = decodeCapturePhoto([{ mediaType: 'image/heic', bytes: heic }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'UNSUPPORTED_MEDIA');
});
