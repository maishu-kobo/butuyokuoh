import { createMember, setTestUser } from './regression-harness';
import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/capture/photo-preview/route';

test('photo preview authenticates, checks origin, strips metadata and does not persist a photo', async () => {
  const member = await createMember('photo-preview');
  process.env.AUTH_URL = 'http://127.0.0.1';
  const bytes = await sharp({create: {width: 12, height: 8, channels: 3, background: '#abcdef'}})
    .withExif({IFD0: {ImageDescription: 'private fixture metadata'}}).png().toBuffer();
  function request(origin = 'http://127.0.0.1') {
    const body = new FormData();
    body.set('photo', new Blob([new Uint8Array(bytes)], {type: 'image/png'}), 'fixture.png');
    return new NextRequest('http://127.0.0.1/api/capture/photo-preview', {method: 'POST', headers: {origin}, body});
  }
  assert.equal((await POST(request('https://foreign.example'))).status, 403);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.width, 12);
  await setTestUser({id: member.id, email: null, name: 'ゲスト', created_at: member.created_at, account_type: 'guest', expiresAt: '2099-01-01T00:00:00Z'});
  assert.equal((await POST(request())).status, 403);
  await setTestUser(null);
  assert.equal((await POST(request())).status, 401);
});
