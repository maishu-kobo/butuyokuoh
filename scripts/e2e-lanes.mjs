/**
 * e2e の置き場。
 * 既定レーンは tests/e2e の *.spec.ts を自動で実行する。
 * 別レーンはファイル名で明示し、既定の一覧には入れない。
 */
export const OTHER_LANE_FILES = {
  'disabled.spec.ts': 'guest-disabled',
  'production-smoke.spec.ts': 'production',
  'live-shops.spec.ts': 'live',
};

export function laneOfSpec(fileName) {
  if (!fileName.endsWith('.spec.ts')) return null;
  return OTHER_LANE_FILES[fileName] || 'default';
}

export function laneFromEnv(env = process.env) {
  if (env.E2E_LIVE_LANE === '1') return 'live';
  if (env.E2E_GUEST_DISABLED) return 'guest-disabled';
  if (env.E2E_PRODUCTION) return 'production';
  return 'default';
}

export function filesForLane(fileNames, lane) {
  return fileNames.filter((name) => laneOfSpec(name) === lane).sort();
}
