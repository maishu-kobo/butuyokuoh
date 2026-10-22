import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.E2E_DB_PATH ||= join(mkdtempSync(join(tmpdir(), 'butuyokuoh-e2e-')), 'test.sqlite');
const port = 3107;
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: process.env.E2E_GUEST_DISABLED ? 'disabled.spec.ts' : ['guest.spec.ts', 'capture.spec.ts', 'capture-photo-pick.spec.ts', 'capture-photo-group.spec.ts', 'capture-flow.spec.ts', 'capture-manual.spec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run ${process.env.E2E_PRODUCTION ? 'start' : 'dev'} -- --port ${port}`,
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
      CAPTURE_TEST_HOOKS: '1',
      CAPTURE_ENABLED: 'true',
      CAPTURE_AI_ENABLED: 'true',
      AMAZON_ASSOCIATE_TAG: 'test-tag-22',
    },
  },
});
