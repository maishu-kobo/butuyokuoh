import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages, decodeCapturePhoto, sniffImage } from '../src/lib/capture/contract';
import { CAPTURE_PHOTO_CONCURRENCY, CAPTURE_PHOTO_MAX_PIXELS, prepareCapturePhoto, withPhotoSlot } from '../src/lib/capture/photo';
import { photoForUpload } from '../src/lib/capture/photo-pick';
import type { ShrinkDeps, ShrinkSource } from '../src/lib/capture/photo-client';

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

function bitmap(width: number, height: number): ShrinkSource {
  return { width, height, source: null as unknown as CanvasImageSource, close() {} };
}

test('a browser-decoded HEIC is not uploaded when the JPEG is over 5MB', async () => {
  const original = new File([heic], 'library.heic', { type: 'image/heic' });
  const result = await photoForUpload([original], {
    async decode() {
      return bitmap(200, 100);
    },
    async encodeJpeg() {
      return new Blob([new Uint8Array(CAPTURE_PHOTO_MAX_BYTES + 1)], { type: 'image/jpeg' });
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok && !result.ignored) assert.equal(result.message, CaptureMessages.photoTooLarge);
});

function box(type: string, payload: Uint8Array, full = false): Uint8Array {
  const header = 8 + (full ? 4 : 0);
  const out = new Uint8Array(header + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, out.length);
  out.set(type.split('').map(char => char.charCodeAt(0)), 4);
  if (full) view.setUint32(8, 0);
  out.set(payload, header);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ispeBox(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  view.setUint32(4, width);
  view.setUint32(8, height);
  return box('ispe', payload);
}

function heifWithIspe(width: number, height: number): Uint8Array {
  const brand = new Uint8Array(8);
  brand.set([0x68, 0x65, 0x69, 0x63], 0);
  const meta = box('meta', box('iprp', box('ipco', ispeBox(width, height))), true);
  return concat([box('ftyp', brand), meta]);
}

const require = createRequire(import.meta.url);

async function expectNoHeicDecode(bytes: Uint8Array): Promise<void> {
  const decode = require('heic-decode') as { all: (input: { buffer: Uint8Array }) => Promise<unknown> };
  const original = decode.all;
  let calls = 0;
  decode.all = async () => {
    calls += 1;
    throw new Error('heic-decode should not run');
  };
  try {
    const result = await prepareCapturePhoto(bytes, 'image/heic');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PHOTO_UNREADABLE');
    assert.equal(calls, 0);
  } finally {
    decode.all = original;
  }
}

test('an HEIF ispe over the pixel budget is refused before heic-decode', async () => {
  await expectNoHeicDecode(heifWithIspe(100_000, 100_000));
  const photo = await import('../src/lib/capture/photo') as typeof import('../src/lib/capture/photo') & {
    heifIspeWithinBudget?: (bytes: Uint8Array) => boolean;
  };
  assert.equal(typeof photo.heifIspeWithinBudget, 'function');
  const within = photo.heifIspeWithinBudget;
  if (!within) return;
  assert.equal(within(heic), true);
  assert.equal(within(heifWithIspe(100_000, 100_000)), false);
  assert.equal(within(heifWithIspe(1, CAPTURE_PHOTO_MAX_PIXELS)), true);
  assert.equal(within(heifWithIspe(1, CAPTURE_PHOTO_MAX_PIXELS + 1)), false);
  assert.equal(within(heifWithIspe(0, 24)), false);
  const brand = new Uint8Array(8);
  brand.set([0x68, 0x65, 0x69, 0x63], 0);
  assert.equal(within(box('ftyp', brand)), false);
});

test('a HEIF without an ispe box is refused before heic-decode', async () => {
  const brand = new Uint8Array(8);
  brand.set([0x68, 0x65, 0x69, 0x63], 0);
  await expectNoHeicDecode(box('ftyp', brand));
});

test('a timed-out HEIC decode keeps its concurrency slot until the decode settles', async () => {
  const decode = require('heic-decode') as { all: (input: { buffer: Uint8Array }) => Promise<unknown> };
  const original = decode.all;
  let release = () => {};
  let released = false;
  const gate = new Promise<void>(resolve => {
    release = () => {
      if (released) return;
      released = true;
      resolve();
    };
  });
  decode.all = async input => {
    await gate;
    return original(input);
  };
  const holders: Array<Promise<unknown>> = [];
  try {
    const result = await prepareCapturePhoto(heic, 'image/heic');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'PHOTO_UNREADABLE');
    let entered = 0;
    for (let index = 0; index < CAPTURE_PHOTO_CONCURRENCY; index += 1) {
      holders.push(withPhotoSlot(async () => {
        entered += 1;
        await new Promise(resolve => setTimeout(resolve, 20));
      }));
    }
    await Promise.resolve();
    assert.equal(entered, CAPTURE_PHOTO_CONCURRENCY - 1);
  } finally {
    release();
    decode.all = original;
    await Promise.all(holders);
  }
});

test('the decode timeout starts only after a photo slot is acquired', async () => {
  const photo = await import('../src/lib/capture/photo') as typeof import('../src/lib/capture/photo') & {
    runPhotoWithinSlot?: <T>(task: () => Promise<T>, timeoutMs: number) => Promise<T>;
  };
  assert.equal(typeof photo.runPhotoWithinSlot, 'function');
  const run = photo.runPhotoWithinSlot;
  if (!run) return;
  let releaseFirst = () => {};
  let releaseSecond = () => {};
  const first = withPhotoSlot(() => new Promise<void>(resolve => {
    releaseFirst = resolve;
  }));
  const second = withPhotoSlot(() => new Promise<void>(resolve => {
    releaseSecond = resolve;
  }));
  let started = false;
  const third = run(async () => {
    started = true;
    return 'ready';
  }, 40);
  let rejected = false;
  third.then(() => undefined, () => {
    rejected = true;
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(started, false);
    assert.equal(rejected, false);
    releaseFirst();
    await first;
    assert.equal(await third, 'ready');
    assert.equal(started, true);
  } finally {
    releaseFirst();
    releaseSecond();
    await first.catch(() => undefined);
    await second.catch(() => undefined);
    await third.catch(() => undefined);
  }
});

test('decodeCapturePhoto still refuses HEIC so the model is only given JPEG', () => {
  const result = decodeCapturePhoto([{ mediaType: 'image/heic', bytes: heic }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'UNSUPPORTED_MEDIA');
});
