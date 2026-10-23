import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capturePhotoActions } from '../src/lib/capture/photo-pick';

test('a coarse pointer uses the OS sheet, and a fine pointer gets a menu', () => {
  assert.equal(capturePhotoActions({ coarsePointer: true, camera: true }), 'sheet');
  assert.equal(capturePhotoActions({ coarsePointer: true, camera: false }), 'sheet');
  assert.deepEqual(capturePhotoActions({ coarsePointer: false, camera: true }), ['camera', 'file']);
  assert.deepEqual(capturePhotoActions({ coarsePointer: false, camera: false }), ['file']);
});
