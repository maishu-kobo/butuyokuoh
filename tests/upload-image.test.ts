import './upload-test-directory';
// 保存されたファイルと、本文を読み切る前に切れるかを見る。ソースの文字列は見ない。
import './bugfix-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createMember } from './bugfix-harness';

const GPS_DESCRIPTION = 'butuyokuoh-gps-test';
const GPS_TRAILER = 'butuyokuoh-gps-trailer';
const GPS_LATITUDE = Buffer.from([0xfb, 0x08, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);
const FILE_LIMIT = 5 * 1024 * 1024;
const BODY_CEILING = FILE_LIMIT + 64 * 1024;

type UploadBody = { url?: string; error?: string };

function uploadRoot(): string {
  return path.join(process.cwd(), 'public', 'uploads');
}

function snapshotUploads(): Set<string> {
  if (!existsSync(uploadRoot())) return new Set();
  return new Set(readdirSync(uploadRoot()));
}

function removeNewUploads(before: Set<string>) {
  if (!existsSync(uploadRoot())) return;
  for (const name of readdirSync(uploadRoot())) {
    if (!before.has(name)) rmSync(path.join(uploadRoot(), name), { force: true });
  }
}

function asBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(buffer);
}

function multipart(parts: { name: string; filename: string; type: string; bytes: Buffer }[]): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = '----uploadimagetest';
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

async function postUpload(bytes: Buffer, filename: string, type: string): Promise<{ status: number; json: UploadBody }> {
  const packed = multipart([{ name: 'file', filename, type, bytes }]);
  const { NextRequest } = await import('next/server');
  const { POST } = await import('../src/app/api/upload/route');
  const request = new NextRequest('http://127.0.0.1/api/upload', {
    method: 'POST',
    headers: { 'content-type': packed.contentType },
    body: packed.body,
  });
  const response = await POST(request);
  return { status: response.status, json: JSON.parse(await response.text()) as UploadBody };
}

function storedFile(url: string): Buffer {
  assert.match(url, /^\/uploads\/[^/]+$/);
  const name = url.slice('/uploads/'.length);
  assert.equal(name.includes('..'), false);
  const file = path.join(uploadRoot(), name);
  assert.equal(existsSync(file), true);
  return readFileSync(file);
}

async function gpsJpeg(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 10, g: 200, b: 30 } },
  }).jpeg().toBuffer();
  const tagged = await sharp(base).withExif({
    IFD0: { ImageDescription: GPS_DESCRIPTION },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '35/1 41/1 2299/100',
      GPSLongitudeRef: 'E',
      GPSLongitude: '139/1 41/1 3077/100',
    },
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  return Buffer.concat([tagged, Buffer.from(GPS_TRAILER)]);
}

async function locatedImage(format: 'png' | 'webp'): Promise<Buffer> {
  const base = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })[format]().toBuffer();
  return sharp(base).withExif({
    IFD0: { ImageDescription: GPS_DESCRIPTION },
    IFD3: {
      GPSLatitudeRef: 'N',
      GPSLatitude: '35/1 41/1 2299/100',
      GPSLongitudeRef: 'E',
      GPSLongitude: '139/1 41/1 3077/100',
    },
  })[format]().toBuffer();
}

test('an upload body over the limit is cut off before the rest is read', async () => {
  await createMember('upload-cut');
  const before = snapshotUploads();
  const chunkSize = 256 * 1024;
  const total = 6 * 1024 * 1024;
  let produced = 0;
  let producedAtCancel = -1;
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
    cancel() {
      if (producedAtCancel < 0) producedAtCancel = produced;
    },
  });
  try {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('../src/app/api/upload/route');
    const request = new NextRequest('http://127.0.0.1/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----uploadcut' },
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await POST(request);
    const json = JSON.parse(await response.text()) as UploadBody;
    assert.ok(producedAtCancel >= 0);
    assert.ok(producedAtCancel < total);
    assert.ok(produced < total);
    // 読み取り側は次の1チャンクを先に積む。超えた塊とその次までで止まり、残りは読まない。
    assert.ok(produced <= BODY_CEILING + chunkSize * 2);
    assert.equal(response.status, 400);
    assert.equal(json.error, 'ファイルサイズは5MB以下にしてください');
    assert.deepEqual(snapshotUploads(), before);
  } finally {
    removeNewUploads(before);
  }
});

test('content-length over the upload limit is rejected before the body is read', async () => {
  await createMember('upload-length');
  const before = snapshotUploads();
  let pulls = 0;
  let produced = 0;
  const total = 6 * 1024 * 1024;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (produced >= total) {
        controller.close();
        return;
      }
      const size = Math.min(64 * 1024, total - produced);
      controller.enqueue(new Uint8Array(size));
      produced += size;
    },
  });
  try {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('../src/app/api/upload/route');
    const request = new NextRequest('http://127.0.0.1/api/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=----uploadlength',
        'content-length': String(total),
      },
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);
    const pullsBeforeHandler = pulls;
    const response = await POST(request);
    const json = JSON.parse(await response.text()) as UploadBody;
    assert.equal(pulls, pullsBeforeHandler);
    assert.equal(response.status, 400);
    assert.equal(json.error, 'ファイルサイズは5MB以下にしてください');
    assert.deepEqual(snapshotUploads(), before);
  } finally {
    removeNewUploads(before);
  }
});

test('a stored jpeg drops EXIF, GPS, and a trailing location note, and stays upright', async () => {
  await createMember('upload-gps');
  const before = snapshotUploads();
  try {
    const original = await gpsJpeg();
    const input = await sharp(original).metadata();
    assert.equal(input.orientation, 6);
    assert.equal(input.width, 40);
    assert.equal(input.height, 20);
    assert.equal(original.includes(GPS_DESCRIPTION), true);
    assert.equal(original.includes(GPS_TRAILER), true);
    assert.equal(original.includes(GPS_LATITUDE), true);

    const uploaded = await postUpload(original, 'vacation-tokyo.jpg', 'image/jpeg');
    assert.equal(uploaded.status, 200);
    const saved = storedFile(uploaded.json.url || '');
    assert.equal(saved.includes(GPS_DESCRIPTION), false);
    assert.equal(saved.includes(GPS_TRAILER), false);
    assert.equal(saved.includes(GPS_LATITUDE), false);
    assert.equal(saved.equals(original), false);
    const meta = await sharp(saved).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
    assert.equal(meta.width, 20);
    assert.equal(meta.height, 40);
    const pixels = await sharp(saved).raw().toBuffer();
    assert.ok(pixels[1] > pixels[0] && pixels[1] > pixels[2]);
  } finally {
    removeNewUploads(before);
  }
});

test('png and webp uploads drop embedded location metadata and keep their format', async () => {
  await createMember('upload-containers');
  const before = snapshotUploads();
  try {
    for (const format of ['png', 'webp'] as const) {
      const original = await locatedImage(format);
      const input = await sharp(original).metadata();
      assert.equal(input.format, format);
      assert.equal(input.exif === undefined, false, format);
      assert.equal(original.includes(GPS_DESCRIPTION), true, format);
      const uploaded = await postUpload(original, `where.${format}`, `image/${format}`);
      assert.equal(uploaded.status, 200, format);
      assert.equal(uploaded.json.url?.endsWith(`.${format}`), true, format);
      const saved = storedFile(uploaded.json.url || '');
      assert.equal(saved.includes(GPS_DESCRIPTION), false, format);
      assert.equal(saved.includes(GPS_LATITUDE), false, format);
      const meta = await sharp(saved).metadata();
      assert.equal(meta.format, format);
      assert.equal(meta.exif, undefined);
      assert.equal(meta.width, 16);
      assert.equal(meta.height, 16);
    }
  } finally {
    removeNewUploads(before);
  }
});

test('saved names are not predictable from the user, the clock, or the original filename', async () => {
  const user = await createMember('upload-name');
  const before = snapshotUploads();
  const fixedNow = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => fixedNow;
  try {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).jpeg().toBuffer();
    const first = await postUpload(jpeg, '../../trip-tokyo.jpeg', 'image/jpeg');
    const second = await postUpload(jpeg, '../../trip-tokyo.jpeg', 'image/jpeg');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const guess = `/uploads/${user.id}_${fixedNow}.jpeg`;
    assert.notEqual(first.json.url, second.json.url);
    assert.notEqual(first.json.url, guess);
    assert.equal(first.json.url?.includes('trip'), false);
    assert.equal(first.json.url?.includes('tokyo'), false);
    assert.equal(first.json.url?.includes(String(fixedNow)), false);
    assert.equal(first.json.url?.includes('..'), false);
    assert.match(first.json.url || '', /^\/uploads\/[A-Za-z0-9_-]{32,}\.jpeg$/);
    assert.match(second.json.url || '', /^\/uploads\/[A-Za-z0-9_-]{32,}\.jpeg$/);
    assert.equal(existsSync(path.join(uploadRoot(), `${user.id}_${fixedNow}.jpeg`)), false);
    const saved = storedFile(first.json.url || '');
    const meta = await sharp(saved).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 8);
    assert.equal(meta.height, 8);
  } finally {
    Date.now = originalNow;
    removeNewUploads(before);
  }
});

test('a file of exactly 5MB is stored and one byte over is refused', async () => {
  await createMember('upload-limit');
  const before = snapshotUploads();
  try {
    const small = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 9, g: 8, b: 7 } },
    }).jpeg().toBuffer();
    const exact = Buffer.concat([small, Buffer.alloc(FILE_LIMIT - small.length)]);
    const over = Buffer.concat([small, Buffer.alloc(FILE_LIMIT + 1 - small.length)]);
    assert.equal(exact.length, FILE_LIMIT);
    assert.equal(over.length, FILE_LIMIT + 1);

    const accepted = await postUpload(exact, 'exact.jpg', 'image/jpeg');
    assert.equal(accepted.status, 200);
    const saved = storedFile(accepted.json.url || '');
    const meta = await sharp(saved).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 8);
    assert.equal(meta.height, 8);
    assert.equal(meta.exif, undefined);

    const refused = await postUpload(over, 'over.jpg', 'image/jpeg');
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, 'ファイルサイズは5MB以下にしてください');
    const names = snapshotUploads();
    assert.equal([...names].some(name => name.includes('over')), false);
    assert.equal(names.size, before.size + 1);
  } finally {
    removeNewUploads(before);
  }
});

test('gif and avif uploads are still stored as those formats', async () => {
  await createMember('upload-formats');
  const before = snapshotUploads();
  try {
    const pixel = { create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 30, b: 40 } } } as const;
    const gif = await sharp(pixel).gif().toBuffer();
    const avif = await sharp(pixel).avif().toBuffer();
    const red = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
    const blue = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const animated = await sharp([red, blue], { join: { animated: true } }).gif().toBuffer();
    const gifUpload = await postUpload(gif, 'move.gif', 'image/gif');
    const avifUpload = await postUpload(avif, 'still.avif', 'image/avif');
    const animatedUpload = await postUpload(animated, 'frames.gif', 'image/gif');
    assert.equal(gifUpload.status, 200);
    assert.equal(avifUpload.status, 200);
    assert.equal(animatedUpload.status, 200);
    assert.equal(gifUpload.json.url?.endsWith('.gif'), true);
    assert.equal(avifUpload.json.url?.endsWith('.avif'), true);
    const gifSaved = storedFile(gifUpload.json.url || '');
    const avifSaved = storedFile(avifUpload.json.url || '');
    assert.equal(gifSaved.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(avifSaved.subarray(4, 8).toString('ascii'), 'ftyp');
    assert.equal(['avif', 'avis'].includes(avifSaved.subarray(8, 12).toString('ascii')), true);
    const gifMeta = await sharp(gifSaved).metadata();
    const avifMeta = await sharp(avifSaved).metadata();
    const animatedMeta = await sharp(storedFile(animatedUpload.json.url || ''), { animated: true }).metadata();
    assert.equal(gifMeta.format, 'gif');
    assert.equal(gifMeta.width, 8);
    assert.equal(avifMeta.width, 8);
    assert.equal(animatedMeta.pages, 2);
  } finally {
    removeNewUploads(before);
  }
});

test('a mismatched extension is refused and nothing is stored', async () => {
  await createMember('upload-mismatch');
  const before = snapshotUploads();
  try {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer();
    const refused = await postUpload(jpeg, 'pretend.png', 'image/png');
    assert.equal(refused.status, 400);
    assert.equal(refused.json.error, '拡張子とファイルの内容が一致しません');
    assert.deepEqual(snapshotUploads(), before);
  } finally {
    removeNewUploads(before);
  }
});
