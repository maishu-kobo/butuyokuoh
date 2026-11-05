import { pathToFileURL } from 'node:url';

/**
 * Anonymous, read-only deployment check. The expected origin comes from the
 * operator, never from the server's own discovery response or environment.
 * @param {string} origin
 * @param {{fetchImpl?: typeof fetch, clientUrls?: string[]}} options
 */
export async function checkMcpPublicConfiguration(origin, { fetchImpl = fetch, clientUrls = [] } = {}) {
  let expected;
  try { expected = new URL(origin); } catch { throw new Error('invalid public origin'); }
  if (expected.origin !== origin || expected.protocol !== 'https:') {
    throw new Error('expected public origin must be a canonical HTTPS origin');
  }
  const resource = `${origin}/api/mcp`;
  const metadata = `${origin}/.well-known/oauth-protected-resource/api/mcp`;
  /** @type {{name: string, ok: boolean}[]} */
  const checks = [];
  const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
  async function read(path, status, json = true, method = 'GET') {
    try {
      const response = await fetchImpl(`${origin}${path}`, {
        method, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/json, text/event-stream', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'public-config-check', version: '1' } },
        }) } : {}),
      });
      check(`${path} HTTP ${status}`, response.status === status);
      if (response.status !== status) { await response.body?.cancel(); return null; }
      if (path === '/api/mcp') {
        const challenge = response.headers.get('www-authenticate') || '';
        check('MCP authentication challenge', /^Bearer\s/i.test(challenge)
          && /resource_metadata="([^"]+)"/.exec(challenge)?.[1] === metadata);
        await response.body?.cancel();
        return null;
      }
      return json ? await response.json() : await response.text();
    } catch {
      // Do not echo response bodies, cookies, exceptions, or arbitrary URLs.
      check(`${path} readable without redirects`, false);
      return null;
    }
  }

  const prm = await read('/.well-known/oauth-protected-resource/api/mcp', 200);
  check('protected resource', prm?.resource === resource);
  check('authorization servers', Array.isArray(prm?.authorization_servers)
    && prm.authorization_servers.length === 1 && prm.authorization_servers[0] === origin);
  const as = await read('/.well-known/oauth-authorization-server', 200);
  for (const [field, path] of Object.entries({
    issuer: '', authorization_endpoint: '/oauth/authorize', token_endpoint: '/api/oauth/token',
    registration_endpoint: '/api/oauth/register', revocation_endpoint: '/api/oauth/revoke',
  })) check(field, as?.[field] === `${origin}${path}`);
  check('PKCE S256', Array.isArray(as?.code_challenge_methods_supported) && as.code_challenge_methods_supported.includes('S256'));
  await read('/api/mcp', 401, false, 'POST');
  const html = await read('/help/agents', 200, false);
  // Inspect displayed code elements, not the Next.js hydration payload/script.
  const displayed = typeof html === 'string'
    ? Array.from(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').matchAll(/<code\b[^>]*>([^<]*)<\/code>/gi), (m) => m[1].trim())
    : [];
  const mcpUrls = displayed.filter((text) => /^https?:\/\//.test(text) && /\/api\/mcp(?:[/?#]|$)/.test(text));
  check('displayed MCP URL', mcpUrls.length > 0 && mcpUrls.every((url) => url === resource));
  clientUrls.forEach((url, i) => check(`client URL ${i + 1}`, url === resource));
  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const [origin, ...args] = process.argv.slice(2);
  const clientUrls = [];
  let valid = Boolean(origin);
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== '--client-url' || !args[i + 1]) valid = false;
    else clientUrls.push(args[i + 1]);
  }
  if (!valid) {
    console.error('Usage: node scripts/check-mcp-public.mjs HTTPS_ORIGIN [--client-url MCP_URL]');
    process.exitCode = 2;
  } else {
    try {
      const result = await checkMcpPublicConfiguration(origin, { clientUrls });
      for (const check of result.checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
      process.exitCode = result.ok ? 0 : 1;
    } catch {
      console.error('Invalid public origin: use a canonical HTTPS origin without path, query, credentials or trailing slash.');
      process.exitCode = 2;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
