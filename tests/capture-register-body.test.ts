import './capture-register-body-env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { installAuthTestHooks } from '../src/lib/auth';
import { CaptureMessages } from '../src/lib/capture/contract';
import { POST as registerPost } from '../src/app/api/capture/register/route';

const LIMIT = 8192;
const CHUNK = 1024;

function byteStream(total: number) {
  const chunk = new Uint8Array(CHUNK).fill(0x78);
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= total) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK, total - pulled);
      controller.enqueue(size === CHUNK ? chunk : chunk.subarray(0, size));
      pulled += size;
    },
  });
  return { stream, pulled: () => pulled };
}

function registerRequest(body: BodyInit, extra: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/capture/register', {
    method: 'POST',
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...extra,
    },
    body,
    duplex: 'half',
  });
}

async function withRegister(fn: () => Promise<void>) {
  const previous = process.env.CAPTURE_ENABLED;
  process.env.CAPTURE_ENABLED = 'true';
  installAuthTestHooks({
    user: {
      id: 1,
      account_type: 'member',
      email: 'register-body@example.test',
      name: '会員',
      created_at: '2026-01-01 00:00:00',
    },
  });
  try {
    await fn();
  } finally {
    installAuthTestHooks(null);
    if (previous === undefined) delete process.env.CAPTURE_ENABLED;
    else process.env.CAPTURE_ENABLED = previous;
  }
}

test('register stops reading an oversized body when content-length is missing', async () => {
  await withRegister(async () => {
    const { stream, pulled } = byteStream(64 * 1024);
    const request = registerRequest(stream);
    assert.equal(request.headers.get('content-length'), null);
    const response = await registerPost(request);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      code: 'INVALID_INPUT',
      error: CaptureMessages.registerInput,
    });
    assert.equal(pulled() <= LIMIT + CHUNK, true, `pulled ${pulled()}`);
  });
});

test('register stops reading when content-length understates the body', async () => {
  await withRegister(async () => {
    const { stream, pulled } = byteStream(64 * 1024);
    const request = registerRequest(stream, { 'content-length': '10' });
    const response = await registerPost(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, CaptureMessages.registerInput);
    assert.equal(pulled() <= LIMIT + CHUNK, true, `pulled ${pulled()}`);
  });
});

test('a declared oversized content-length is rejected before the body is read', async () => {
  await withRegister(async () => {
    const { stream, pulled } = byteStream(64 * 1024);
    const request = registerRequest(stream, { 'content-length': '9000' });
    const response = await registerPost(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
    // リクエストの実装が1チャンクだけ先に取ることがある。残りは読まない。
    assert.equal(pulled() <= CHUNK, true, `pulled ${pulled()}`);
  });
});

test('a small register body is still parsed when content-length is missing', async () => {
  await withRegister(async () => {
    const text = JSON.stringify({ candidateIds: [1] });
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.close();
          return;
        }
        sent = true;
        controller.enqueue(new TextEncoder().encode(text));
      },
    });
    const request = registerRequest(stream);
    assert.equal(request.headers.get('content-length'), null);
    const response = await registerPost(request);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      code: 'INVALID_INPUT',
      error: 'この機能はログイン後に利用できます',
    });
  });
});
