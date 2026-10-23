import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { CAPTURE_PHOTO_MAX_BYTES, CaptureMessages } from '../src/lib/capture/contract';
import { CAPTURE_BITMAP_OPTIONS, fitPhotoEdge, shrinkPhotoForUpload } from '../src/lib/capture/photo-client';
import { createWorkersAiIdentifier, type WorkersAiHttpRequest } from '../src/lib/capture/workers-ai';
import {
  CAPTURE_PHOTO_CONCURRENCY,
  CAPTURE_PHOTO_MAX_EDGE,
  CAPTURE_PHOTO_MAX_PIXELS,
  captureBodyByteLimit,
  contentLengthExceedsCaptureBody,
  prepareCapturePhoto,
  readBoundedStream,
  readCapturePhoto,
  runBoundedPhotoTask,
  withPhotoSlot,
} from '../src/lib/capture/photo';

const GPS_DESCRIPTION = 'butuyokuoh-gps-test';
// 2299/100 written as a little-endian TIFF rational. The tag name is not stored as text.
const GPS_LATITUDE = Buffer.from([0xfb, 0x08, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);

function crc32(buf: Buffer): number {
  let crc = ~0 >>> 0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const scanline = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 40)]);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function gpsJpeg(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 200, b: 30 } },
  }).jpeg().toBuffer();
  return sharp(base).withExif({
    IFD0: { ImageDescription: GPS_DESCRIPTION },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '35/1 41/1 2299/100',
      GPSLongitudeRef: 'E',
      GPSLongitude: '139/1 41/1 3077/100',
    },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
}

function asBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(buffer);
}

function multipart(parts: { name: string; filename: string; type: string; bytes: Buffer }[]): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = '----capturetest';
  const chunks = parts.flatMap(part => [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
    ),
    part.bytes,
    Buffer.from('\r\n'),
  ]);
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: asBody(Buffer.concat(chunks)), contentType: `multipart/form-data; boundary=${boundary}` };
}

test('photo limits match the capture spec', () => {
  assert.equal(CAPTURE_PHOTO_MAX_EDGE, 1600);
  assert.equal(CAPTURE_PHOTO_MAX_PIXELS, 40_000_000);
  assert.equal(CAPTURE_PHOTO_CONCURRENCY, 2);
  assert.ok(captureBodyByteLimit() > CAPTURE_PHOTO_MAX_BYTES);
  assert.ok(captureBodyByteLimit() <= CAPTURE_PHOTO_MAX_BYTES + 64 * 1024);
  assert.equal(contentLengthExceedsCaptureBody(null), false);
  assert.equal(contentLengthExceedsCaptureBody(String(captureBodyByteLimit())), false);
  assert.equal(contentLengthExceedsCaptureBody(String(captureBodyByteLimit() + 1)), true);
  assert.equal(contentLengthExceedsCaptureBody('nope'), true);
  assert.equal(CAPTURE_BITMAP_OPTIONS.imageOrientation, 'from-image');
});

test('a body over 5MB is cancelled before the rest is read', async () => {
  const chunkSize = 256 * 1024;
  const total = 15 * 1024 * 1024;
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced >= total) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, total - produced);
      controller.enqueue(new Uint8Array(size));
      produced += size;
    },
  });
  const result = await readBoundedStream(stream, captureBodyByteLimit());
  assert.equal(result.ok, false);
  assert.ok(produced < total);
  assert.ok(produced <= captureBodyByteLimit() + chunkSize);
  assert.equal('bytes' in result, false);
});

test('content-length over the photo limit is rejected before the body is read', async () => {
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(new Uint8Array(1024));
    },
  });
  const request = new Request('http://localhost/api/capture/identify', {
    method: 'POST',
    headers: {
      'content-type': 'multipart/form-data; boundary=----x',
      'content-length': String(15 * 1024 * 1024),
    },
    body: stream,
    duplex: 'half',
  } as RequestInit);
  const result = await readCapturePhoto(request);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, 'PHOTO_TOO_LARGE');
  assert.equal(result.error.error, CaptureMessages.photoTooLarge);
  assert.equal(result.status, 413);
  assert.equal(pulls, 0);
});

test('re-encoded photos drop EXIF and GPS, fix orientation, and cap the long edge', async () => {
  const original = await gpsJpeg();
  const input = await sharp(original).metadata();
  assert.equal(input.orientation, 6);
  assert.equal(Buffer.from(original).includes(GPS_LATITUDE), true);
  assert.equal(Buffer.from(original).includes(GPS_DESCRIPTION), true);

  const prepared = await prepareCapturePhoto(new Uint8Array(original));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  assert.equal(prepared.value.mediaType, 'image/jpeg');
  const output = Buffer.from(prepared.value.bytes);
  assert.equal(output.includes(GPS_LATITUDE), false);
  assert.equal(output.includes(GPS_DESCRIPTION), false);
  assert.notEqual(output.equals(Buffer.from(original)), true);
  const meta = await sharp(output).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.width, 20);
  assert.equal(meta.height, 40);

  const pngPhoto = await sharp({
    create: { width: 3200, height: 1000, channels: 3, background: { r: 0, g: 0, b: 255 } },
  }).png().toBuffer();
  const resized = await prepareCapturePhoto(new Uint8Array(pngPhoto), 'image/png');
  assert.equal(resized.ok, true);
  if (!resized.ok) return;
  const resizedMeta = await sharp(Buffer.from(resized.value.bytes)).metadata();
  assert.equal(resizedMeta.format, 'jpeg');
  assert.equal(resizedMeta.width, 1600);
  assert.equal(resizedMeta.height, 500);
  assert.equal(resizedMeta.exif, undefined);

  const webp = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).webp().toBuffer();
  const fromWebp = await prepareCapturePhoto(new Uint8Array(webp));
  assert.equal(fromWebp.ok, true);
  if (!fromWebp.ok) return;
  assert.equal(fromWebp.value.bytes[0], 0xff);
  assert.equal(fromWebp.value.bytes[1], 0xd8);
});

test('Workers AI is sent the shrunk JPEG and not the original photo or its GPS', async () => {
  const wide = await sharp({
    create: { width: 3200, height: 1000, channels: 3, background: { r: 9, g: 8, b: 7 } },
  }).jpeg().toBuffer();
  const original = await sharp(wide).withExif({
    IFD0: { ImageDescription: GPS_DESCRIPTION },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '35/1 41/1 2299/100',
      GPSLongitudeRef: 'E',
      GPSLongitude: '139/1 41/1 3077/100',
    },
  }).jpeg().toBuffer();
  assert.equal(original.includes(GPS_LATITUDE), true);
  assert.equal(original.includes(GPS_DESCRIPTION), true);

  const packed = multipart([{ name: 'photo', filename: 'where.jpg', type: 'image/jpeg', bytes: original }]);
  const prepared = await readCapturePhoto(new Request('http://localhost/api/capture/identify', {
    method: 'POST',
    headers: { 'content-type': packed.contentType },
    body: packed.body,
  }));
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;

  const calls: WorkersAiHttpRequest[] = [];
  const identifier = createWorkersAiIdentifier({
    accountId: 'a'.repeat(32),
    apiToken: 'test-cloudflare-token',
    userId: '7',
    http: async (request) => {
      calls.push(request);
      return {
        status: 200,
        body: JSON.stringify({
          success: true,
          result: {
            response: JSON.stringify({
              confidence: 'sure',
              products: [{ name: 'テスト用ゲルボールペン 0.5', brand: '物欲文具', model: 'BY-05', jan: '4900000000009' }],
            }),
          },
          errors: [],
          messages: [],
        }),
      };
    },
  });
  const result = await identifier.identify(prepared.value);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body) as { image?: string };
  const prefix = 'data:image/jpeg;base64,';
  assert.equal(payload.image?.startsWith(prefix), true);
  const sent = Buffer.from(payload.image!.slice(prefix.length), 'base64');
  assert.equal(sent.equals(Buffer.from(prepared.value.bytes)), true);
  assert.equal(sent.includes(GPS_LATITUDE), false);
  assert.equal(sent.includes(GPS_DESCRIPTION), false);
  assert.equal(calls[0].body.includes(original.toString('base64')), false);
  assert.equal(calls[0].body.includes(GPS_DESCRIPTION), false);
  const meta = await sharp(sent).metadata();
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 500);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
});

test('the server rejects HEIC and a pixel bomb without keeping the original', async () => {
  const heic = Uint8Array.of(0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0);
  const rejected = await prepareCapturePhoto(heic, 'image/heic');
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.error.code, 'PHOTO_UNREADABLE');
    assert.equal(rejected.error.error, CaptureMessages.photoUnreadable);
    assert.equal(rejected.status, 400);
    assert.equal(JSON.stringify(rejected.error).includes('ftypheic'), false);
  }

  const part = multipart([{ name: 'photo', filename: 'iphone.heic', type: 'image/heic', bytes: Buffer.from(heic) }]);
  const fromRequest = await readCapturePhoto(new Request('http://localhost/api/capture/identify', {
    method: 'POST',
    headers: { 'content-type': part.contentType },
    body: part.body,
  }));
  assert.equal(fromRequest.ok, false);
  if (!fromRequest.ok) assert.equal(fromRequest.error.code, 'PHOTO_UNREADABLE');

  const started = Date.now();
  const bomb = await prepareCapturePhoto(new Uint8Array(png(8000, 8000)));
  assert.ok(Date.now() - started < 2000);
  assert.equal(bomb.ok, false);
  if (!bomb.ok) {
    assert.equal(bomb.error.code, 'PHOTO_UNREADABLE');
    assert.equal(bomb.error.error, CaptureMessages.photoUnreadable);
    assert.equal(JSON.stringify(bomb.error).includes('8000'), false);
  }

  const gif = Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0);
  const unreadable = await prepareCapturePhoto(gif, 'image/gif');
  assert.equal(unreadable.ok, false);
  if (!unreadable.ok) assert.equal(unreadable.error.code, 'PHOTO_UNREADABLE');
});

test('photo processing allows two at a time and times out without keeping the task', async () => {
  let active = 0;
  let max = 0;
  await Promise.all([1, 2, 3, 4].map(() => withPhotoSlot(async () => {
    active += 1;
    max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 40));
    active -= 1;
  })));
  assert.equal(max, CAPTURE_PHOTO_CONCURRENCY);

  await assert.rejects(() => withPhotoSlot(async () => {
    throw new Error('boom');
  }));
  let ran = false;
  await withPhotoSlot(async () => {
    ran = true;
  });
  assert.equal(ran, true);

  const started = Date.now();
  await assert.rejects(() => runBoundedPhotoTask(() => new Promise(() => {}), 40));
  assert.ok(Date.now() - started < 1000);
});

test('one uploaded photo is re-encoded and a second file is refused', async () => {
  const jpeg = await sharp({
    create: { width: 12, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
  }).withExif({ IFD0: { ImageDescription: 'keep-me-out' } }).jpeg().toBuffer();
  const single = multipart([{ name: 'photo', filename: 'a.jpg', type: 'image/jpeg', bytes: jpeg }]);
  const accepted = await readCapturePhoto(new Request('http://localhost/api/capture/identify', {
    method: 'POST',
    headers: { 'content-type': single.contentType },
    body: single.body,
  }));
  assert.equal(accepted.ok, true);
  if (!accepted.ok) return;
  assert.equal(accepted.value.mediaType, 'image/jpeg');
  assert.equal(Buffer.from(accepted.value.bytes).includes('keep-me-out'), false);
  assert.equal(Buffer.from(accepted.value.bytes).equals(jpeg), false);
  const meta = await sharp(Buffer.from(accepted.value.bytes)).metadata();
  assert.equal(meta.exif, undefined);

  const pngPhoto = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 9, g: 9, b: 9 } },
  }).png().toBuffer();
  const two = multipart([
    { name: 'photo', filename: 'a.jpg', type: 'image/jpeg', bytes: jpeg },
    { name: 'photo', filename: 'b.png', type: 'image/png', bytes: pngPhoto },
  ]);
  const refused = await readCapturePhoto(new Request('http://localhost/api/capture/identify', {
    method: 'POST',
    headers: { 'content-type': two.contentType },
    body: two.body,
  }));
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.error.code, 'INVALID_INPUT');
    assert.equal(refused.error.error, CaptureMessages.onePhoto);
  }
});

test('the long edge fits inside 1600px without enlarging', () => {
  assert.deepEqual(fitPhotoEdge(3200, 1000), { width: 1600, height: 500 });
  assert.deepEqual(fitPhotoEdge(1000, 3000), { width: 533, height: 1600 });
  assert.deepEqual(fitPhotoEdge(1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitPhotoEdge(100, 50), { width: 100, height: 50 });
  assert.deepEqual(fitPhotoEdge(1601, 1601), { width: 1600, height: 1600 });
});

test('browser shrink emits a new jpeg and does not return the original bytes', async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const original = new Blob([secret], { type: 'image/jpeg' });
  let closed = false;
  const result = await shrinkPhotoForUpload(original, {
    async decode() {
      return {
        width: 3200,
        height: 1000,
        close() {
          closed = true;
        },
        source: null as unknown as CanvasImageSource,
      };
    },
    async encodeJpeg(_decoded, width, height, quality) {
      assert.equal(width, 1600);
      assert.equal(height, 500);
      assert.equal(quality, 0.8);
      return new Blob([Uint8Array.of(0xff, 0xd8, 0xff)], { type: 'image/jpeg' });
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.value.blob, original);
  assert.equal(result.value.blob.type, 'image/jpeg');
  assert.equal(closed, true);
  assert.equal(Buffer.from(await result.value.blob.arrayBuffer()).equals(Buffer.from(secret)), false);

  const failed = await shrinkPhotoForUpload(original, {
    async decode() {
      throw new Error(Buffer.from(secret).toString('hex'));
    },
    async encodeJpeg() {
      throw new Error('unused');
    },
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.error.error, CaptureMessages.photoUnreadable);
    assert.equal(JSON.stringify(failed.error).includes(Buffer.from(secret).toString('hex')), false);
  }
});
