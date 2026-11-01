import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Non-sensitive deployment identity. Never expose settings or database contents.
export function GET() {
  try {
    const sha = readFileSync(join(process.cwd(), 'RELEASE_SHA'), 'utf8').trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('unconfigured release');
    return Response.json({ ok: true, sha }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
