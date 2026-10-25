import { createFakePorts, isFakeScenario, type FakeScenario } from './fakes';
import type { CapturePorts } from './contract';

function scenarioFromEnv(): FakeScenario {
  const value = process.env.CAPTURE_FAKE_SCENARIO;
  return value && isFakeScenario(value) ? value : 'default';
}

let current: CapturePorts = createFakePorts(scenarioFromEnv());

export function getCapturePorts(): CapturePorts {
  return current;
}

export function setCapturePorts(next: CapturePorts): void {
  current = next;
}

export function resetCapturePorts(): void {
  current = createFakePorts(scenarioFromEnv());
}

// 偽物を使ってよいのは、本番以外で CAPTURE_TEST_HOOKS が 1 のときだけ。秘密は読まない。
// 名前は変数で引く。process.env.NAME と書くとビルド時に値が埋め込まれる。
export function captureTestEnv(
  env: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string } = process.env,
): { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string } {
  const source = env as Record<string, string | undefined>;
  const read = (name: string) => {
    const value = source[name];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    NODE_ENV: read('NODE_ENV'),
    CAPTURE_TEST_HOOKS: read('CAPTURE_TEST_HOOKS'),
  };
}

// テストからシナリオを渡す口。本番ではヘッダーを見ない。秘密は読まない。
export function portsForRequest(
  scenarioHeader: string | null,
  env: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string } = process.env,
): CapturePorts {
  const testEnv = captureTestEnv(env);
  if (testEnv.NODE_ENV === 'production' || testEnv.CAPTURE_TEST_HOOKS !== '1') return getCapturePorts();
  if (!scenarioHeader || !isFakeScenario(scenarioHeader)) return getCapturePorts();
  return createFakePorts(scenarioHeader);
}
