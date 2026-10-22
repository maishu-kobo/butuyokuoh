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

// テストからシナリオを渡す口。本番ではヘッダーを見ない。秘密は読まない。
export function portsForRequest(
  scenarioHeader: string | null,
  env: { NODE_ENV?: string; CAPTURE_TEST_HOOKS?: string } = process.env,
): CapturePorts {
  if (env.NODE_ENV === 'production' || env.CAPTURE_TEST_HOOKS !== '1') return getCapturePorts();
  if (!scenarioHeader || !isFakeScenario(scenarioHeader)) return getCapturePorts();
  return createFakePorts(scenarioHeader);
}
