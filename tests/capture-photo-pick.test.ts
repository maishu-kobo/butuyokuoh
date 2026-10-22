import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureMessages } from '../src/lib/capture/contract';
import { classifyPickedPhotos, showPhotoPicker } from '../src/lib/capture/photo-pick';

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const webp = Uint8Array.of(...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'));
const heic = Uint8Array.of(0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0);

function file(name: string, type: string, bytes: Uint8Array): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

test('the photo picker is shown only to a member while capture is enabled', () => {
  assert.equal(showPhotoPicker({ enabled: true }, false), true);
  assert.equal(showPhotoPicker({ enabled: true }, true), false);
  assert.equal(showPhotoPicker({ enabled: false }, false), false);
  assert.equal(showPhotoPicker(null, false), false);
});

test('one jpeg, png, or webp can be chosen, and two files or HEIC cannot', async () => {
  for (const picked of [
    file('a.jpg', 'image/jpeg', jpeg),
    file('a.png', '', png),
    file('a.webp', 'image/webp', webp),
  ]) {
    const result = await classifyPickedPhotos([picked]);
    assert.equal(result.ok, true, picked.name);
  }

  const none = await classifyPickedPhotos([]);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.ignored, true);

  const two = await classifyPickedPhotos([
    file('a.jpg', 'image/jpeg', jpeg),
    file('b.png', 'image/png', png),
  ]);
  assert.equal(two.ok, false);
  if (!two.ok && !two.ignored) assert.equal(two.message, CaptureMessages.onePhoto);

  for (const picked of [
    file('a.heic', 'image/heic', heic),
    file('a.jpg', 'image/jpeg', heic),
    file('a.gif', 'image/gif', Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)),
  ]) {
    const result = await classifyPickedPhotos([picked]);
    assert.equal(result.ok, false, picked.name);
    if (!result.ok && !result.ignored) assert.equal(result.message, CaptureMessages.photoUnreadable);
  }
});
