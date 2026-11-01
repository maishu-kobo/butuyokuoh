import { defineConfig } from '@playwright/test';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filesForLane, laneFromEnv, OTHER_LANE_FILES } from './scripts/e2e-lanes.mjs';

process.env.E2E_DB_PATH ||= join(mkdtempSync(join(tmpdir(), 'butuyokuoh-e2e-')), 'test.sqlite');
const port = 3107;
const lane = laneFromEnv();
const specNames = readdirSync('tests/e2e');
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: lane === 'default' ? /.*\.spec\.ts/ : filesForLane(specNames, lane),
  testIgnore: lane === 'default' ? Object.keys(OTHER_LANE_FILES) : undefined,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run ${lane === 'production' ? 'start' : 'dev'} -- --port ${port}`,
    url: `http://localhost:${port}/api/auth/guest`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      BUTUYOKUOH_DB_PATH: process.env.E2E_DB_PATH,
      GUEST_MODE_ENABLED: process.env.E2E_GUEST_DISABLED ? 'false' : 'true',
      GUEST_ALLOWED_ORIGINS: 'http://127.0.0.1:3107',
      GUEST_MAX_ITEMS: '8', GUEST_MAX_CATEGORIES: '5', GUEST_MAX_GROUPS: '4', GUEST_MAX_HISTORY: '20',
      AUTH_URL: `http://localhost:${port}`, NEXTAUTH_URL: `http://localhost:${port}`,
      AUTH_SECRET: 'guest-e2e-only-auth-secret-not-for-production',
      NEXTAUTH_SECRET: 'guest-e2e-only-auth-secret-not-for-production',
      JWT_SECRET: 'guest-e2e-only-jwt-secret-not-for-production',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
      // 開発サーバのテストだけでシナリオを切り替える。本番の NODE_ENV ではヘッダーを無視する。
      // 本番スモークはこの鍵を渡さない。
      ...(lane === 'production' ? {} : { CAPTURE_TEST_HOOKS: '1' }),
      // 既定レーンだけ、店の代わりに固定ページを返す。本番ではポートが無効。
      ...(lane === 'default' ? { E2E_PRODUCT_FIXTURES: '1' } : {}),
      CAPTURE_ENABLED: 'true',
      CAPTURE_AI_ENABLED: 'true',
      AMAZON_ASSOCIATE_TAG: 'test-tag-22',
    },
  },
});
