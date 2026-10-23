import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capturePhotoActions } from '../src/lib/capture/photo-pick';

test('a coarse pointer uses the OS sheet, and a fine pointer gets a menu', () => {
  assert.equal(capturePhotoActions({ coarsePointer: true, camera: true }), 'sheet');
  assert.equal(capturePhotoActions({ coarsePointer: true, camera: false }), 'sheet');
  assert.deepEqual(capturePhotoActions({ coarsePointer: false, camera: true }), ['camera', 'file']);
  assert.deepEqual(capturePhotoActions({ coarsePointer: false, camera: false }), ['file']);
});

test('the picker has one 写真から登録 button instead of 撮る and 写真を選ぶ', () => {
  const picker = readFileSync(new URL('../src/components/CapturePhotoPicker.tsx', import.meta.url), 'utf8');
  assert.equal(picker.includes('写真から登録'), true);
  assert.equal(picker.includes('>撮る<'), false);
  assert.equal(picker.includes('>写真を選ぶ<'), false);
  assert.equal(picker.includes('aria-haspopup="menu"'), true);
  assert.equal(picker.includes('aria-label="写真ファイル"'), true);
  assert.equal(picker.includes('aria-label="写真を撮る"'), true);
});
