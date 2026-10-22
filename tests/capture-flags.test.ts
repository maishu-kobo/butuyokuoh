import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest, NextResponse } from 'next/server';
import {
  CAPTURE_AI_DISABLED_MESSAGE,
  CaptureDisabledError,
  captureFlags,
  denyCaptureAi,
  denyCaptureFeature,
  withCapture,
  withCaptureAi,
} from '../src/lib/capture-flags';
import { GET, POST } from '../src/app/api/capture/route';
import { POST as identifyPost } from '../src/app/api/capture/identify/route';
import { POST as searchPost } from '../src/app/api/capture/search/route';

const FLAG_NAMES = ['CAPTURE_ENABLED', 'CAPTURE_AI_ENABLED'] as const;

function withFlags(values: Partial<Record<(typeof FLAG_NAMES)[number], string>>, fn: () => Promise<void> | void) {
  const previous = new Map<string, string | undefined>();
  for (const name of FLAG_NAMES) {
    previous.set(name, process.env[name]);
    const next = values[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  const restore = () => {
    for (const name of FLAG_NAMES) {
      const prior = previous.get(name);
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

test('photo capture stays hidden unless CAPTURE_ENABLED is exactly true', () => {
  for (const value of [undefined, '', 'false', '0', '1', 'yes', 'TRUE', ' true', 'true ']) {
    withFlags(value === undefined ? {} : { CAPTURE_ENABLED: value }, () => {
      assert.deepEqual(captureFlags(), { enabled: false, aiEnabled: false });
      const denied = denyCaptureFeature();
      assert.ok(denied);
      assert.equal(denied.status, 404);
      assert.equal(denied.code, 'CAPTURE_DISABLED');
      assert.equal(denied.fallback, null);
    });
  }
});

test('CAPTURE_ENABLED=true shows the entry and opens the feature API', async () => {
  await withFlags({ CAPTURE_ENABLED: 'true' }, async () => {
    assert.deepEqual(captureFlags(), { enabled: true, aiEnabled: false });
    assert.equal(denyCaptureFeature(), null);
    const status = await GET();
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { enabled: true, aiEnabled: false });
    const opened = await POST();
    assert.equal(opened.status, 200);
    assert.deepEqual(await opened.json(), { enabled: true, aiEnabled: false });
  });
});

test('disabled flag hides the entry and rejects the feature API', async () => {
  await withFlags({}, async () => {
    const status = await GET();
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await status.json(), { enabled: false, aiEnabled: false });
    const denied = await POST();
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), {
      error: 'この機能は利用できません',
      code: 'CAPTURE_DISABLED',
    });
  });
});

test('CAPTURE_AI_ENABLED stops only photo identification', async () => {
  await withFlags({ CAPTURE_ENABLED: 'true', CAPTURE_AI_ENABLED: 'false' }, async () => {
    assert.equal(denyCaptureFeature(), null);
    const denied = denyCaptureAi();
    assert.ok(denied);
    assert.equal(denied.status, 503);
    assert.equal(denied.code, 'CAPTURE_AI_DISABLED');
    assert.equal(denied.fallback, 'manual-entry');
    assert.equal(denied.error, CAPTURE_AI_DISABLED_MESSAGE);
    const opened = await POST();
    assert.equal(opened.status, 200);
  });

  await withFlags({ CAPTURE_ENABLED: 'true', CAPTURE_AI_ENABLED: 'true' }, () => {
    assert.deepEqual(captureFlags(), { enabled: true, aiEnabled: true });
    assert.equal(denyCaptureAi(), null);
  });

  await withFlags({ CAPTURE_AI_ENABLED: 'true' }, () => {
    assert.deepEqual(captureFlags(), { enabled: false, aiEnabled: false });
    assert.equal(denyCaptureAi()?.code, 'CAPTURE_DISABLED');
  });
});

test('wrappers reject hidden capture calls and do not leak flag values', async () => {
  await withFlags({}, async () => {
    const handler = withCapture(() => NextResponse.json({ secret: 'should-not-run' }));
    const response = await handler();
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.equal(body.includes('should-not-run'), false);
    assert.equal(body.includes('CAPTURE_ENABLED'), false);
  });

  await withFlags({ CAPTURE_ENABLED: 'true' }, async () => {
    const ai = withCaptureAi(() => NextResponse.json({ ran: true }));
    const response = await ai();
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'CAPTURE_AI_DISABLED');
    assert.equal(body.fallback, 'manual-entry');
    assert.equal(JSON.stringify(body).includes('CAPTURE_AI_ENABLED'), false);
  });

  await withFlags({ CAPTURE_ENABLED: 'true', CAPTURE_AI_ENABLED: 'true' }, async () => {
    const response = await withCaptureAi(() => NextResponse.json({ ran: true }))();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ran: true });
  });
});

function captureRequest(path: string, body?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: body ? { origin: 'http://localhost', 'content-type': 'application/json' } : undefined,
    body,
  });
}

test('identify and search stay closed unless CAPTURE_ENABLED is exactly true', async () => {
  await withFlags({}, async () => {
    const identifyResponse = await identifyPost(captureRequest('/api/capture/identify'));
    assert.equal(identifyResponse.status, 404);
    assert.equal(identifyResponse.headers.get('cache-control'), 'no-store');
    const identifyBody = await identifyResponse.json();
    assert.equal(identifyBody.code, 'CAPTURE_DISABLED');
    assert.equal(identifyBody.error, 'この機能は利用できません');
    assert.equal('fallback' in identifyBody, false);
    assert.equal(JSON.stringify(identifyBody).includes('CAPTURE_ENABLED'), false);

    const searchResponse = await searchPost(captureRequest('/api/capture/search', JSON.stringify({ name: 'ペン' })));
    assert.equal(searchResponse.status, 404);
    const searchBody = await searchResponse.json();
    assert.equal(searchBody.code, 'CAPTURE_DISABLED');
    assert.equal(searchBody.error, 'この機能は利用できません');
  });
});

test('CAPTURE_AI_ENABLED stops photo identification and leaves name search open', async () => {
  await withFlags({ CAPTURE_ENABLED: 'true' }, async () => {
    const identifyResponse = await identifyPost(captureRequest('/api/capture/identify'));
    assert.equal(identifyResponse.status, 503);
    const identifyBody = await identifyResponse.json();
    assert.equal(identifyBody.code, 'CAPTURE_AI_DISABLED');
    assert.equal(identifyBody.fallback, 'manual-entry');
    assert.equal(identifyBody.error, CAPTURE_AI_DISABLED_MESSAGE);
    assert.equal(JSON.stringify(identifyBody).includes('CAPTURE_AI_ENABLED'), false);

    let searchStatus: number;
    try {
      searchStatus = (await searchPost(captureRequest('/api/capture/search', JSON.stringify({ name: 'ペン' })))).status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      assert.equal(message.includes('CAPTURE_AI_DISABLED'), false);
      assert.equal(message.includes('この機能は利用できません'), false);
      return;
    }
    assert.notEqual(searchStatus, 404);
    assert.notEqual(searchStatus, 503);
  });
});

test('CaptureDisabledError is the typed rejection for hidden APIs', () => {
  withFlags({}, () => {
    const error = new CaptureDisabledError();
    assert.equal(error.status, 404);
    assert.equal(error.code, 'CAPTURE_DISABLED');
    assert.equal(error instanceof Error, true);
  });
});
