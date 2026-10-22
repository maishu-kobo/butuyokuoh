import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import {
  AI_UNAVAILABLE_MESSAGE,
  CAPTURE_SECRET_NAMES,
  SEARCH_UNAVAILABLE_MESSAGE,
  amazonAssociateTag,
  captureAvailability,
  readCaptureSecrets,
} from '../src/lib/capture-secrets';

const ENV_NAMES = [
  CAPTURE_SECRET_NAMES.cloudflareAccountId,
  CAPTURE_SECRET_NAMES.cloudflareApiToken,
  CAPTURE_SECRET_NAMES.yahooAppId,
  CAPTURE_SECRET_NAMES.rakutenAppId,
  CAPTURE_SECRET_NAMES.rakutenAccessKey,
  CAPTURE_SECRET_NAMES.amazonAssociateTag,
  'CAPTURE_SECRETS_FILE',
] as const;

const FAKE = {
  CLOUDFLARE_ACCOUNT_ID: 'example-cloudflare-account',
  CLOUDFLARE_API_TOKEN: 'example-cloudflare-token',
  YAHOO_SHOPPING_APP_ID: 'example-yahoo-app-id',
  RAKUTEN_APP_ID: 'example-rakuten-app-id',
  RAKUTEN_ACCESS_KEY: 'example-rakuten-access-key',
  AMAZON_ASSOCIATE_TAG: 'example-associate-tag',
} as const;

function withEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string>>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const name of ENV_NAMES) {
    previous.set(name, process.env[name]);
    const next = values[name];
    if (next === undefined) delete process.env[name];
    else process.env[name] = next;
  }
  try {
    fn();
  } finally {
    for (const name of ENV_NAMES) {
      const prior = previous.get(name);
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    }
  }
}

function unavailable(message: string) {
  return { available: false, fallback: 'manual-entry' as const, message };
}

function available() {
  return { available: true, fallback: null, message: null };
}

function captureLogs(fn: () => void): string {
  const chunks: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map(name => [name, console[name]] as const);
  for (const name of methods) {
    console[name] = (...args: unknown[]) => {
      chunks.push(args.map(value => String(value)).join(' '));
    };
  }
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const record = ((chunk: unknown) => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = record;
  process.stderr.write = record;
  try {
    fn();
  } finally {
    for (const [name, original] of saved) console[name] = original;
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
  return chunks.join('\n');
}

function assertNoSecrets(text: string, secrets: string[]) {
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, 'secret appeared in output');
  }
}

test('missing keys report AI and search unavailable and do not throw', () => {
  withEnv({}, () => {
    assert.doesNotThrow(() => {
      readCaptureSecrets();
      captureAvailability();
      amazonAssociateTag();
    });
    assert.deepEqual(readCaptureSecrets(), {
      cloudflareAccountId: null,
      cloudflareApiToken: null,
      yahooAppId: null,
      rakutenAppId: null,
      rakutenAccessKey: null,
      amazonAssociateTag: null,
    });
    assert.equal(amazonAssociateTag(), null);
    assert.deepEqual(captureAvailability(), {
      ai: unavailable(AI_UNAVAILABLE_MESSAGE),
      search: {
        yahoo: unavailable(SEARCH_UNAVAILABLE_MESSAGE),
        rakuten: unavailable(SEARCH_UNAVAILABLE_MESSAGE),
      },
      secretsFile: 'unused',
    });
  });
});

test('each service is available only when its own keys are set', () => {
  withEnv({ YAHOO_SHOPPING_APP_ID: FAKE.YAHOO_SHOPPING_APP_ID, RAKUTEN_APP_ID: FAKE.RAKUTEN_APP_ID }, () => {
    const report = captureAvailability();
    assert.deepEqual(report.ai, unavailable(AI_UNAVAILABLE_MESSAGE));
    assert.deepEqual(report.search.yahoo, available());
    assert.deepEqual(report.search.rakuten, unavailable(SEARCH_UNAVAILABLE_MESSAGE));
    assert.equal(JSON.stringify(report).includes(FAKE.YAHOO_SHOPPING_APP_ID), false);
    assert.equal(JSON.stringify(report).includes(FAKE.RAKUTEN_APP_ID), false);
  });

  withEnv({
    CLOUDFLARE_ACCOUNT_ID: FAKE.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: FAKE.CLOUDFLARE_API_TOKEN,
    RAKUTEN_APP_ID: FAKE.RAKUTEN_APP_ID,
    RAKUTEN_ACCESS_KEY: FAKE.RAKUTEN_ACCESS_KEY,
    AMAZON_ASSOCIATE_TAG: '   ',
  }, () => {
    const report = captureAvailability();
    assert.deepEqual(report.ai, available());
    assert.deepEqual(report.search.yahoo, unavailable(SEARCH_UNAVAILABLE_MESSAGE));
    assert.deepEqual(report.search.rakuten, available());
    assert.equal(amazonAssociateTag(), null);
    assert.equal(JSON.stringify(report).includes(FAKE.CLOUDFLARE_API_TOKEN), false);
  });
});

test('blank and non-exact values count as missing, and the associate tag is trimmed', () => {
  withEnv({
    CLOUDFLARE_ACCOUNT_ID: '  ',
    CLOUDFLARE_API_TOKEN: '',
    YAHOO_SHOPPING_APP_ID: FAKE.YAHOO_SHOPPING_APP_ID,
    AMAZON_ASSOCIATE_TAG: `  ${FAKE.AMAZON_ASSOCIATE_TAG}  `,
  }, () => {
    const secrets = readCaptureSecrets();
    assert.equal(secrets.cloudflareAccountId, null);
    assert.equal(secrets.yahooAppId, FAKE.YAHOO_SHOPPING_APP_ID);
    assert.equal(secrets.amazonAssociateTag, FAKE.AMAZON_ASSOCIATE_TAG);
    assert.equal(amazonAssociateTag(), FAKE.AMAZON_ASSOCIATE_TAG);
    assert.equal(captureAvailability().ai.available, false);
  });
});

test('keys are not written to logs or the public availability report', () => {
  withEnv(FAKE, () => {
    const secrets = Object.values(FAKE);
    const logged = captureLogs(() => {
      const loaded = readCaptureSecrets();
      const report = captureAvailability();
      assert.equal(loaded.cloudflareApiToken, FAKE.CLOUDFLARE_API_TOKEN);
      assert.equal(loaded.rakutenAccessKey, FAKE.RAKUTEN_ACCESS_KEY);
      assertNoSecrets(JSON.stringify(report), secrets);
      assert.equal(JSON.stringify(report).includes(FAKE.AMAZON_ASSOCIATE_TAG), false);
    });
    assertNoSecrets(logged, secrets);
  });
});

test('server-only guard throws before exposing keys when imported for the browser', () => {
  const globalWithWindow = globalThis as Omit<typeof globalThis, 'window'> & { window?: Window & typeof globalThis };
  const previous = globalWithWindow.window;
  globalWithWindow.window = {} as Window & typeof globalThis;
  try {
    withEnv({ CLOUDFLARE_API_TOKEN: FAKE.CLOUDFLARE_API_TOKEN }, () => {
      assert.throws(() => readCaptureSecrets(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'capture secrets are server-only');
        assert.equal(error.message.includes(FAKE.CLOUDFLARE_API_TOKEN), false);
        return true;
      });
      assert.throws(() => captureAvailability(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(FAKE.CLOUDFLARE_API_TOKEN), false);
        return true;
      });
    });
  } finally {
    if (previous === undefined) delete globalWithWindow.window;
    else globalWithWindow.window = previous;
  }
});

test('a mode-600 file outside the repository fills only missing keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-secrets-'));
  const file = join(dir, 'capture.env');
  const fileToken = 'example-file-cloudflare-token';
  const fileAccount = 'example-file-cloudflare-account';
  try {
    writeFileSync(file, [
      '# comment',
      'CLOUDFLARE_ACCOUNT_ID=' + fileAccount,
      'CLOUDFLARE_API_TOKEN="' + fileToken + '"',
      'YAHOO_SHOPPING_APP_ID=example-file-yahoo',
      "OTHER_SECRET=example-other-secret",
      'RAKUTEN_ACCESS_KEY=abc=def',
      '',
    ].join('\n'), { mode: 0o600 });
    chmodSync(file, 0o600);

    withEnv({
      CAPTURE_SECRETS_FILE: file,
      CLOUDFLARE_API_TOKEN: FAKE.CLOUDFLARE_API_TOKEN,
      RAKUTEN_APP_ID: FAKE.RAKUTEN_APP_ID,
    }, () => {
      const logged = captureLogs(() => {
        const secrets = readCaptureSecrets();
        assert.equal(secrets.cloudflareAccountId, fileAccount);
        assert.equal(secrets.cloudflareApiToken, FAKE.CLOUDFLARE_API_TOKEN);
        assert.equal(secrets.yahooAppId, 'example-file-yahoo');
        assert.equal(secrets.rakutenAppId, FAKE.RAKUTEN_APP_ID);
        assert.equal(secrets.rakutenAccessKey, 'abc=def');
        assert.equal(Object.prototype.hasOwnProperty.call(secrets, 'OTHER_SECRET'), false);
        const report = captureAvailability();
        assert.equal(report.secretsFile, 'loaded');
        assert.equal(report.ai.available, true);
        assert.equal(report.search.yahoo.available, true);
        assert.equal(report.search.rakuten.available, true);
        assertNoSecrets(JSON.stringify(report), [fileToken, fileAccount, FAKE.CLOUDFLARE_API_TOKEN, 'example-file-yahoo', 'example-other-secret', 'abc=def']);
      });
      assertNoSecrets(logged, [fileToken, fileAccount, FAKE.CLOUDFLARE_API_TOKEN, 'example-other-secret']);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('insecure or in-repo secret files are ignored instead of crashing', () => {
  const outside = mkdtempSync(join(tmpdir(), 'capture-secrets-bad-'));
  const loose = join(outside, 'loose.env');
  const linkedTarget = join(outside, 'target.env');
  const link = join(outside, 'link.env');
  const huge = join(outside, 'huge.env');
  const inside = join(process.cwd(), 'capture-secrets.local');
  const directory = join(outside, 'dir.env');
  try {
    writeFileSync(loose, 'CLOUDFLARE_API_TOKEN=example-loose-token\nCLOUDFLARE_ACCOUNT_ID=example-loose-account\n');
    chmodSync(loose, 0o644);
    writeFileSync(linkedTarget, 'YAHOO_SHOPPING_APP_ID=example-linked-yahoo\n', { mode: 0o600 });
    chmodSync(linkedTarget, 0o600);
    symlinkSync(linkedTarget, link);
    writeFileSync(huge, 'YAHOO_SHOPPING_APP_ID=example-huge-yahoo\n' + 'a'.repeat(8192));
    chmodSync(huge, 0o600);
    writeFileSync(inside, 'RAKUTEN_APP_ID=example-inside-app\nRAKUTEN_ACCESS_KEY=example-inside-key\n', { mode: 0o600 });
    chmodSync(inside, 0o600);
    mkdirSync(directory, { mode: 0o700 });

    for (const [path, leaked] of [
      [loose, 'example-loose-token'],
      [link, 'example-linked-yahoo'],
      [huge, 'example-huge-yahoo'],
      [inside, 'example-inside-key'],
      [directory, ''],
      [join(outside, 'missing.env'), ''],
    ] as const) {
      withEnv({ CAPTURE_SECRETS_FILE: path }, () => {
        const logged = captureLogs(() => {
          assert.doesNotThrow(() => readCaptureSecrets());
          const secrets = readCaptureSecrets();
          const report = captureAvailability();
          assert.equal(report.secretsFile, 'rejected');
          assert.equal(report.ai.available, false);
          assert.equal(report.search.yahoo.available, false);
          assert.equal(report.search.rakuten.available, false);
          assert.equal(secrets.cloudflareApiToken, null);
          assert.equal(secrets.yahooAppId, null);
          assert.equal(secrets.rakutenAccessKey, null);
          if (leaked) assertNoSecrets(JSON.stringify(report) + JSON.stringify(secrets), [leaked]);
        });
        if (leaked) assertNoSecrets(logged, [leaked]);
      });
    }
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(inside, { force: true });
  }
});

test('read-only mode 0400 is not accepted; only 0600 is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-secrets-mode-'));
  const file = join(dir, 'secrets.env');
  try {
    writeFileSync(file, 'YAHOO_SHOPPING_APP_ID=example-readonly-yahoo\n');
    chmodSync(file, 0o400);
    withEnv({ CAPTURE_SECRETS_FILE: file }, () => {
      assert.equal(captureAvailability().secretsFile, 'rejected');
      assert.equal(readCaptureSecrets().yahooAppId, null);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a mode-600 file inside the repository is ignored even when the path starts with dots', () => {
  const secret = 'example-inside-dot-yahoo';
  const paths = [join(process.cwd(), '...', 'secrets.env'), join(process.cwd(), '..secrets.env')];
  try {
    for (const file of paths) {
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, `YAHOO_SHOPPING_APP_ID=${secret}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
      withEnv({ CAPTURE_SECRETS_FILE: file }, () => {
        const report = captureAvailability();
        assert.equal(report.secretsFile, 'rejected', file);
        assert.equal(report.search.yahoo.available, false, file);
        assert.equal(readCaptureSecrets().yahooAppId, null, file);
        assert.equal(JSON.stringify(readCaptureSecrets()).includes(secret), false);
      });
    }
  } finally {
    rmSync(join(process.cwd(), '...'), { recursive: true, force: true });
    rmSync(join(process.cwd(), '..secrets.env'), { force: true });
  }
});

test('values are not expanded and a variable assignment is not executed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-secrets-literal-'));
  const file = join(dir, 'secrets.env');
  try {
    writeFileSync(file, 'YAHOO_SHOPPING_APP_ID=$CLOUDFLARE_API_TOKEN\n');
    chmodSync(file, 0o600);
    withEnv({ CAPTURE_SECRETS_FILE: file, CLOUDFLARE_API_TOKEN: FAKE.CLOUDFLARE_API_TOKEN }, () => {
      assert.equal(readCaptureSecrets().yahooAppId, '$CLOUDFLARE_API_TOKEN');
      assert.equal(readCaptureSecrets().cloudflareApiToken, FAKE.CLOUDFLARE_API_TOKEN);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secret names stay out of client code and .env.example has names only', () => {
  const names = Object.values(CAPTURE_SECRET_NAMES);
  const allowed = new Set([
    join('src', 'lib', 'capture-secrets.ts'),
    join('tests', 'capture-secrets.test.ts'),
    '.env.example',
  ]);
  const roots = ['src', 'tests'];
  const files: string[] = ['.env.example'];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) files.push(path);
    }
  };
  for (const root of roots) walk(root);

  const clientPrefixes = ['NEXT_PUBLIC_CLOUDFLARE', 'NEXT_PUBLIC_YAHOO', 'NEXT_PUBLIC_RAKUTEN', 'NEXT_PUBLIC_AMAZON'];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // This test file names the forbidden prefixes. Every other file must not.
    if (file !== join('tests', 'capture-secrets.test.ts')) {
      for (const prefix of clientPrefixes) assert.equal(text.includes(prefix), false, file);
    }
    if (allowed.has(file) || !file.startsWith(`src${sep}`)) continue;
    for (const name of names) assert.equal(text.includes(name), false, `${file} mentions ${name}`);
    // 検索APIはローダーを呼んでよい。キーの名前そのものはここに置かない。
    if (file !== join('src', 'app', 'api', 'capture', 'search', 'route.ts')) {
      assert.equal(text.includes('capture-secrets'), false, file);
    }
  }

  const source = readFileSync(join('src', 'lib', 'capture-secrets.ts'), 'utf8');
  assert.equal(source.includes('process.env.CLOUDFLARE'), false);
  assert.equal(source.includes('process.env.YAHOO'), false);
  assert.equal(source.includes('process.env.RAKUTEN'), false);
  assert.equal(source.includes('process.env.AMAZON'), false);
  assert.equal(source.includes('console.'), false);

  const example = readFileSync('.env.example', 'utf8');
  for (const name of names) assert.match(example, new RegExp(`^${name}=$`, 'm'));
  for (const line of example.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    assert.equal(trimmed.slice(trimmed.indexOf('=') + 1), '');
  }
});

test('client components do not import the secrets module', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
  for (const file of walk('src')) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (!text.includes("'use client'") && !text.includes('"use client"')) continue;
    assert.equal(text.includes('capture-secrets'), false, file);
  }
});

test('secret file descriptor is a regular file outside the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-secrets-stat-'));
  const file = join(dir, 'secrets.env');
  try {
    const fd = openSync(file, 'w', 0o600);
    writeSync(fd, 'AMAZON_ASSOCIATE_TAG=example-fd-tag\n');
    closeSync(fd);
    chmodSync(file, 0o600);
    const stats = statSync(file);
    assert.equal(stats.mode & 0o777, 0o600);
    assert.equal(relative(process.cwd(), file).startsWith('..'), true);
    withEnv({ CAPTURE_SECRETS_FILE: file }, () => {
      assert.equal(captureAvailability().secretsFile, 'loaded');
      assert.equal(amazonAssociateTag(), 'example-fd-tag');
      assert.equal(JSON.stringify(captureAvailability()).includes('example-fd-tag'), false);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
