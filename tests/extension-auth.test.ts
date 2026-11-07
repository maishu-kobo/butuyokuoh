import './regression-harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { call, createMember, db, setTestUser } from './regression-harness';

const tokensPath = '../src/app/api/agent-tokens/route.ts';
const extensionAdd = '../src/app/api/extension-add/route.ts';
const extensionImport = '../src/app/api/extension-import/route.ts';
const extensionCategories = '../src/app/api/extension-categories/route.ts';
const agentMePath = '../src/app/api/agent/v1/me/route.ts';

const sameOrigin = { origin: 'http://localhost' } as const;
const sameOriginUrl = 'http://localhost';

let exclusive: Promise<void> = Promise.resolve();

function serial(run: () => Promise<void>): Promise<void> {
  const next = exclusive.then(run, run);
  exclusive = next.then(() => undefined, () => undefined);
  return next;
}

async function createScopedToken(scopes: ('read' | 'write' | 'extension')[], name = 'ext') {
  const created = await call(
    tokensPath,
    'POST',
    '/api/agent-tokens',
    { name, scopes, expiresInDays: 90 },
    undefined,
    sameOrigin,
    `${sameOriginUrl}/api/agent-tokens`,
  );
  assert.equal(created.status, 201, created.text);
  return created.json as {
    token: string;
    record: { id: number; scopes: string[]; active: boolean };
  };
}

test('extension auth: extension scope token can add and is marked', () => serial(async () => {
  const user = await createMember('ext-token');
  const created = await createScopedToken(['extension'], 'Chrome拡張');
  assert.deepEqual(created.record.scopes, ['extension']);

  const deniedMe = await call(agentMePath, 'GET', '/api/agent/v1/me', undefined, undefined, {
    Authorization: `Bearer ${created.token}`,
  });
  assert.equal(deniedMe.status, 403, deniedMe.text);

  const fixtures = await import('../src/lib/product-regression-fixtures');
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(fixtures.regressionFetchPort());
  try {
    const added = await call(
      extensionAdd,
      'POST',
      '/api/extension-add',
      {
        item: {
          name: '拡張追加',
          url: 'https://example.test/ext-token-add',
          price: 100,
          imageUrl: null,
          priority: 3,
          categoryId: null,
        },
      },
      undefined,
      { Authorization: `Bearer ${created.token}` },
    );
    assert.equal(added.status, 200, added.text);
    assert.equal((added.json as { auth_warning?: string }).auth_warning, undefined);

    const database = await db();
    const row = database.prepare(
      'SELECT added_by_agent_token_id FROM items WHERE id = ?',
    ).get((added.json as { id: number }).id) as { added_by_agent_token_id: number | null };
    assert.equal(row.added_by_agent_token_id, created.record.id);
  } finally {
    port.installProductFetchPort(null);
  }

  const cats = await call(
    extensionCategories,
    'GET',
    '/api/extension-categories',
    undefined,
    undefined,
    { Authorization: `Bearer ${created.token}` },
  );
  assert.equal(cats.status, 200, cats.text);
  await setTestUser(user);
}));

test('extension auth: read/write agent tokens cannot use extension APIs', () => serial(async () => {
  await createMember('ext-scope-deny');
  const readWrite = await createScopedToken(['read', 'write'], 'agent-full');

  const add = await call(
    extensionAdd,
    'POST',
    '/api/extension-add',
    {
      item: {
        name: '拒否',
        url: 'https://example.test/denied',
        price: null,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    },
    undefined,
    { Authorization: `Bearer ${readWrite.token}` },
  );
  assert.equal(add.status, 403, add.text);
  assert.equal((add.json as { code: string }).code, 'AGENT_SCOPE_DENIED');

  const cats = await call(
    extensionCategories,
    'GET',
    '/api/extension-categories',
    undefined,
    undefined,
    { Authorization: `Bearer ${readWrite.token}` },
  );
  assert.equal(cats.status, 403, cats.text);
}));

test('extension auth: legacy JWT works during migration and is rejected after cutoff', () => serial(async () => {
  const member = await createMember('ext-legacy');
  const { generateToken } = await import('../src/lib/auth');
  const {
    EXTENSION_AUTH_HEADER,
    EXTENSION_AUTH_LEGACY_VALUE,
    isExtensionLegacyJwtAllowed,
  } = await import('../src/lib/extension-auth');
  const jwt = generateToken(member as never);

  const previous = process.env.EXTENSION_LEGACY_JWT_UNTIL;
  const fixtures = await import('../src/lib/product-regression-fixtures');
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(fixtures.regressionFetchPort());
  try {
    process.env.EXTENSION_LEGACY_JWT_UNTIL = '2099-01-01T00:00:00.000Z';
    assert.equal(isExtensionLegacyJwtAllowed(), true);

    const ok = await call(extensionAdd, 'POST', '/api/extension-add', {
      token: jwt,
      item: {
        name: '移行中',
        url: 'https://example.test/legacy-jwt-ok',
        price: 10,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((ok.json as { auth_warning?: string }).auth_warning, 'legacy_jwt_deprecated');
    assert.equal(ok.headers.get(EXTENSION_AUTH_HEADER), EXTENSION_AUTH_LEGACY_VALUE);

    const { GET } = await import('../src/app/api/extension-categories/route');
    const cats = await GET(new NextRequest('http://127.0.0.1/api/extension-categories', {
      headers: { Authorization: `Bearer ${jwt}` },
    }));
    assert.equal(cats.status, 200);
    assert.equal(cats.headers.get(EXTENSION_AUTH_HEADER), EXTENSION_AUTH_LEGACY_VALUE);

    process.env.EXTENSION_LEGACY_JWT_UNTIL = '2000-01-01T00:00:00.000Z';
    assert.equal(isExtensionLegacyJwtAllowed(), false);

    const rejected = await call(extensionAdd, 'POST', '/api/extension-add', {
      token: jwt,
      item: {
        name: '期限後',
        url: 'https://example.test/legacy-jwt-expired',
        price: 10,
        imageUrl: null,
        priority: 3,
        categoryId: null,
      },
    });
    assert.equal(rejected.status, 401, rejected.text);
    assert.equal((rejected.json as { code: string }).code, 'EXTENSION_LEGACY_JWT_EXPIRED');

    const imported = await call(extensionImport, 'POST', '/api/extension-import', {
      token: jwt,
      source: 'amazon',
      items: [{ name: 'x', url: 'https://example.test/after-cutoff', price: null, imageUrl: null }],
    });
    assert.equal(imported.status, 401, imported.text);
  } finally {
    port.installProductFetchPort(null);
    if (previous === undefined) delete process.env.EXTENSION_LEGACY_JWT_UNTIL;
    else process.env.EXTENSION_LEGACY_JWT_UNTIL = previous;
  }
}));

test('extension auth: Bearer prefers extension token over body JWT', () => serial(async () => {
  const member = await createMember('ext-bearer');
  const { generateToken } = await import('../src/lib/auth');
  const jwt = generateToken(member as never);
  const created = await createScopedToken(['extension'], 'bearer-pref');

  process.env.EXTENSION_LEGACY_JWT_UNTIL = '2099-01-01T00:00:00.000Z';
  const fixtures = await import('../src/lib/product-regression-fixtures');
  const port = await import('../src/lib/product-fetch-port');
  port.installProductFetchPort(fixtures.regressionFetchPort());
  try {
    const added = await call(
      extensionAdd,
      'POST',
      '/api/extension-add',
      {
        token: jwt,
        item: {
          name: 'Bearer優先',
          url: 'https://example.test/bearer-pref',
          price: null,
          imageUrl: null,
          priority: 3,
          categoryId: null,
        },
      },
      undefined,
      { Authorization: `Bearer ${created.token}` },
    );
    assert.equal(added.status, 200, added.text);
    assert.equal((added.json as { auth_warning?: string }).auth_warning, undefined);
    const database = await db();
    const row = database.prepare(
      'SELECT added_by_agent_token_id FROM items WHERE id = ?',
    ).get((added.json as { id: number }).id) as { added_by_agent_token_id: number | null };
    assert.equal(row.added_by_agent_token_id, created.record.id);
  } finally {
    port.installProductFetchPort(null);
    delete process.env.EXTENSION_LEGACY_JWT_UNTIL;
  }
}));
