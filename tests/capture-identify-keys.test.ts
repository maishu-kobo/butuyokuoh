// キーが無いときの偽物は、開発のテストフックのときだけ。
// このファイルの regression-harness は、db を読む import より先に置く。
import { createMember, setTestUser } from './regression-harness';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { CaptureMessages, type IdentifyResponse, type ProductIdentifier } from '../src/lib/capture/contract';
import { fallbackFromIdentify } from '../src/lib/capture/capture-flow';
import {
  createAiBudget,
  resolveProductIdentifier,
  type WorkersAiHttp,
  type WorkersAiHttpResponse,
} from '../src/lib/capture/workers-ai';
import { POST as identifyPost } from '../src/app/api/capture/identify/route';

const ACCOUNT = 'b'.repeat(32);
const TOKEN = 'test-cloudflare-token';
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0x00);
const FAKE_NAME = 'テスト用ゲルボールペン 0.5';
const REAL_NAME = '牛乳';
const SURE: IdentifyResponse = {
  confidence: 'sure',
  products: [{ name: REAL_NAME, brand: null, model: null, jan: null }],
};
const UNAVAILABLE = {
  ok: false as const,
  status: 503,
  error: { code: 'AI_UNAVAILABLE' as const, error: CaptureMessages.aiFailed },
};

type TestEnv = { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string };

const fake: ProductIdentifier = {
  async identify() {
    return {
      ok: true,
      value: {
        confidence: 'sure',
        products: [{ name: FAKE_NAME, brand: '物欲文具', model: 'BY-05', jan: '4900000000009' }],
      },
    };
  },
};

function textResult(): WorkersAiHttpResponse {
  return {
    status: 200,
    body: JSON.stringify({ success: true, result: { response: JSON.stringify(SURE) }, errors: [], messages: [] }),
  };
}

function openIdentifier(options: {
  hooked: boolean;
  accountId: string | null;
  apiToken: string | null;
  env?: TestEnv;
}) {
  const calls: string[] = [];
  const http: WorkersAiHttp = async (request) => {
    calls.push(request.url);
    return textResult();
  };
  const input = {
    hooked: options.hooked,
    accountId: options.accountId,
    apiToken: options.apiToken,
    userId: '7',
    fake,
    budget: createAiBudget(),
    http,
    now: () => Date.UTC(2026, 9, 22, 9, 0, 0),
    env: options.env,
  };
  return { identifier: resolveProductIdentifier(input), calls };
}

async function identified(options: {
  hooked?: boolean;
  accountId?: string | null;
  apiToken?: string | null;
  env?: TestEnv;
}) {
  const opened = openIdentifier({
    hooked: options.hooked ?? false,
    accountId: options.accountId === undefined ? null : options.accountId,
    apiToken: options.apiToken === undefined ? null : options.apiToken,
    env: options.env,
  });
  return { result: await opened.identifier.identify({ mediaType: 'image/jpeg', bytes: jpeg }), calls: opened.calls, identifier: opened.identifier };
}

test('missing cloudflare keys in production return AI_UNAVAILABLE instead of the fake product', async () => {
  const { result, calls, identifier } = await identified({
    env: { NODE_ENV: 'production' },
  });
  assert.deepEqual(result, UNAVAILABLE);
  assert.equal(calls.length, 0);
  assert.notEqual(identifier, fake);
});

test('missing cloudflare keys in development without test hooks return AI_UNAVAILABLE', async () => {
  const { result, calls, identifier } = await identified({
    env: { NODE_ENV: 'development' },
  });
  assert.deepEqual(result, UNAVAILABLE);
  assert.equal(calls.length, 0);
  assert.notEqual(identifier, fake);
});

test('CAPTURE_TEST_HOOKS=1 in production still returns AI_UNAVAILABLE', async () => {
  const missing = await identified({
    env: { NODE_ENV: 'production', CAPTURE_TEST_HOOKS: '1' },
  });
  assert.deepEqual(missing.result, UNAVAILABLE);
  assert.equal(missing.calls.length, 0);
  assert.notEqual(missing.identifier, fake);
});

test('production does not serve the fake identifier when hooks are on and a scenario is forced', async () => {
  const forced = await identified({
    hooked: true,
    accountId: ACCOUNT,
    apiToken: TOKEN,
    env: { NODE_ENV: 'production', CAPTURE_TEST_HOOKS: '1' },
  });
  assert.equal(forced.result.ok, true);
  if (forced.result.ok) assert.equal(forced.result.value.products[0]?.name, REAL_NAME);
  assert.equal(forced.calls.length, 1);
  assert.equal(forced.calls[0]?.includes(TOKEN), false);
  assert.notEqual(forced.identifier, fake);
});

test('CAPTURE_TEST_HOOKS=1 outside production returns the fake identifier', async () => {
  for (const nodeEnv of ['development', 'test', undefined] as const) {
    const { result, calls, identifier } = await identified({
      env: { NODE_ENV: nodeEnv, CAPTURE_TEST_HOOKS: '1' },
    });
    assert.equal(identifier, fake, nodeEnv ?? '(unset)');
    assert.equal(result.ok, true, nodeEnv ?? '(unset)');
    if (result.ok) assert.equal(result.value.products[0]?.name, FAKE_NAME, nodeEnv ?? '(unset)');
    assert.equal(calls.length, 0, nodeEnv ?? '(unset)');
  }
});

test('invalid cloudflare keys outside test mode return AI_UNAVAILABLE and do not call the network', async () => {
  const { result, calls, identifier } = await identified({
    accountId: 'not-a-cloudflare-account',
    apiToken: TOKEN,
    env: { NODE_ENV: 'production' },
  });
  assert.deepEqual(result, UNAVAILABLE);
  assert.equal(calls.length, 0);
  assert.notEqual(identifier, fake);
});

function asBody(buffer: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(buffer);
}

function multipart(bytes: Buffer): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = '----capturekeys';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body: asBody(body), contentType: `multipart/form-data; boundary=${boundary}` };
}

const ROUTE_ENV = [
  'NODE_ENV',
  'CAPTURE_ENABLED',
  'CAPTURE_AI_ENABLED',
  'CAPTURE_TEST_HOOKS',
  'CAPTURE_SECRETS_FILE',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'AUTH_URL',
  'NEXTAUTH_URL',
] as const;

function writeEnv(name: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

async function withRouteEnv(values: Partial<Record<(typeof ROUTE_ENV)[number], string | undefined>>, fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  for (const name of ROUTE_ENV) {
    previous.set(name, process.env[name]);
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    writeEnv(name, values[name]);
  }
  try {
    await fn();
  } finally {
    for (const [name, prior] of previous) writeEnv(name, prior);
    await setTestUser(null);
  }
}

test('POST /api/capture/identify returns the manual fallback when keys are missing outside test hooks', async () => {
  const origin = 'http://127.0.0.1';
  const photo = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).jpeg().toBuffer();
  const packed = multipart(photo);
  await createMember('identify-no-keys');
  await withRouteEnv({
    NODE_ENV: 'development',
    CAPTURE_ENABLED: 'true',
    CAPTURE_AI_ENABLED: 'true',
    CAPTURE_TEST_HOOKS: undefined,
    CAPTURE_SECRETS_FILE: undefined,
    CLOUDFLARE_ACCOUNT_ID: undefined,
    CLOUDFLARE_API_TOKEN: undefined,
    AUTH_URL: origin,
    NEXTAUTH_URL: undefined,
  }, async () => {
    const response = await identifyPost(new NextRequest(`${origin}/api/capture/identify`, {
      method: 'POST',
      headers: { origin, 'content-type': packed.contentType },
      body: packed.body,
    }));
    const body: unknown = await response.json();
    assert.deepEqual({ status: response.status, body }, {
      status: 503,
      body: {
        code: 'AI_UNAVAILABLE',
        error: CaptureMessages.aiFailed,
        fallback: 'manual-entry',
      },
    });
    assert.deepEqual(fallbackFromIdentify(body, response.ok), { enter: true, name: '' });
    assert.equal(JSON.stringify(body).includes(FAKE_NAME), false);
  });
});

test('POST /api/capture/identify keeps the fake product when test hooks are on outside production', async () => {
  const origin = 'http://127.0.0.1';
  const photo = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 20, g: 40, b: 60 } },
  }).jpeg().toBuffer();
  const packed = multipart(photo);
  await createMember('identify-hooks');
  await withRouteEnv({
    NODE_ENV: 'development',
    CAPTURE_ENABLED: 'true',
    CAPTURE_AI_ENABLED: 'true',
    CAPTURE_TEST_HOOKS: '1',
    CAPTURE_SECRETS_FILE: undefined,
    CLOUDFLARE_ACCOUNT_ID: undefined,
    CLOUDFLARE_API_TOKEN: undefined,
    AUTH_URL: origin,
    NEXTAUTH_URL: undefined,
  }, async () => {
    const response = await identifyPost(new NextRequest(`${origin}/api/capture/identify`, {
      method: 'POST',
      headers: { origin, 'content-type': packed.contentType },
      body: packed.body,
    }));
    const body: unknown = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      confidence: 'sure',
      products: [{ name: FAKE_NAME, brand: '物欲文具', model: 'BY-05', jan: '4900000000009' }],
    });
    assert.deepEqual(fallbackFromIdentify(body, response.ok), { enter: false });
  });
});
