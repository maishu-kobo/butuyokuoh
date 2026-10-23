import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as pageModule from '../src/app/capture-hydration/page';

const NOT_FOUND = 'NEXT_HTTP_ERROR_FALLBACK;404';

function hydrationPage(): () => { type?: { name?: string } } {
  const exported = pageModule.default as { default?: () => { type?: { name?: string } } } | (() => { type?: { name?: string } });
  const page = typeof exported === 'function' ? exported : exported.default;
  if (typeof page !== 'function') throw new Error('水和ページの関数が無い');
  return page;
}

function isNotFound(error: unknown) {
  return error instanceof Error && (error as { digest?: string }).digest === NOT_FOUND;
}

function withEnv(env: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string }, run: () => void) {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    CAPTURE_TEST_HOOKS: process.env.CAPTURE_TEST_HOOKS,
  };
  process.env.NODE_ENV = env.NODE_ENV;
  if (env.CAPTURE_TEST_HOOKS === undefined) delete process.env.CAPTURE_TEST_HOOKS;
  else process.env.CAPTURE_TEST_HOOKS = env.CAPTURE_TEST_HOOKS;
  try {
    run();
  } finally {
    if (previous.NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.NODE_ENV;
    if (previous.CAPTURE_TEST_HOOKS === undefined) delete process.env.CAPTURE_TEST_HOOKS;
    else process.env.CAPTURE_TEST_HOOKS = previous.CAPTURE_TEST_HOOKS;
  }
}

test('the hydration page is not found in production or without the test hook', () => {
  const page = hydrationPage();
  withEnv({ NODE_ENV: 'production', CAPTURE_TEST_HOOKS: '1' }, () => {
    assert.throws(() => page(), isNotFound);
  });
  withEnv({ NODE_ENV: 'development', CAPTURE_TEST_HOOKS: undefined }, () => {
    assert.throws(() => page(), isNotFound);
  });
  withEnv({ NODE_ENV: 'development', CAPTURE_TEST_HOOKS: '1' }, () => {
    assert.equal(page().type?.name, 'CaptureHydrationPicker');
  });
});

test('playwright ci does not apt-install webkit', () => {
  for (const file of ['.github/workflows/playwright.yml', '.github/workflows/quarantine.yml']) {
    const source = readFileSync(file, 'utf8');
    assert.equal(source.includes('install-deps'), false, file);
    assert.equal(source.includes('webkit'), false, file);
  }
  const verify = readFileSync('scripts/verify-playwright-browsers.mjs', 'utf8');
  assert.equal(verify.includes('webkit'), false);
});
