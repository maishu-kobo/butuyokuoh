import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chooseRunner } from './blacksmith-budget.mjs';
import { readHistory } from './blacksmith-history.mjs';

function cli(binary, args, input) {
  const childEnv = { ...process.env, BLACKSMITH_DISABLE_AUTO_UPDATE: '1' };
  // GitHub credentials stay with GitHub; the provider token is supplied only on stdin.
  for (const name of ['GITHUB_TOKEN', 'GH_TOKEN', 'BLACKSMITH_ORG_TOKEN', 'BLACKSMITH_API_URL', 'BLACKSMITH_DASHBOARD_URL']) delete childEnv[name];
  const result = spawnSync(binary, args, {
    encoding: 'utf8', input, timeout: 20_000, maxBuffer: 1024 * 1024,
    env: childEnv,
  });
  if (result.error || result.status !== 0) throw new Error('blacksmith-unavailable');
  return result.stdout;
}

export async function runGuard(env = process.env, now = new Date(), fetchImpl = globalThis.fetch) {
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(env.GITHUB_OUTPUT, 'runner=ubuntu-latest\n');
  let authenticated = false;
  const read = (kind) => async (window) => {
    if (!env.BLACKSMITH_BINARY || !env.BLACKSMITH_ORG_TOKEN) throw new Error('authentication-unavailable');
    if (!authenticated) {
      cli(env.BLACKSMITH_BINARY,
        ['auth', 'login', '--api-token', '-', '--non-interactive', '--organization', 'maishu-kobo'],
        `${env.BLACKSMITH_ORG_TOKEN}\n`);
      authenticated = true;
    }
    return JSON.parse(cli(env.BLACKSMITH_BINARY, [
      'usage', ...kind, '--org', 'maishu-kobo', '--format', 'json',
      '--start-time', window.start, '--end-time', window.end,
    ]));
  };
  const result = await chooseRunner({ env, now, readUsage: read([]), readStorage: read(['storage']),
    readHistory: (window, anchor) => readHistory(env, window, anchor, fetchImpl) });
  appendFileSync(env.GITHUB_OUTPUT, `runner=${result.runner}\nreason=${result.reason}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY,
    `CI runner: \`${result.runner}\` (${result.reason}).\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runGuard().catch(() => {
    process.stderr.write('Runner selection failed; use GitHub.\n');
    process.exitCode = 1;
  });
}
