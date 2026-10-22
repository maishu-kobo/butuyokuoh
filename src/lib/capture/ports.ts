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
