import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthorizePending, OAUTH_CSRF_COOKIE } from '@/lib/agent-oauth';
import { getDb } from '@/lib/db';
import OAuthConsentClient from './OAuthConsentClient';

export const dynamic = 'force-dynamic';

type Props = {
  searchParams: Promise<{ pending?: string }>;
};

export default async function OAuthConsentPage({ searchParams }: Props) {
  const params = await searchParams;
  const pendingId = params.pending || '';
  if (!pendingId) notFound();

  const pending = getAuthorizePending(pendingId);
  if (!pending) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <h1 className="text-xl font-bold">認可の有効期限切れ</h1>
        <p className="mt-2">もう一度エージェント側から接続をやり直してください。</p>
      </main>
    );
  }

  const db = getDb();
  const client = db.prepare(
    'SELECT client_name, client_id FROM agent_oauth_clients WHERE client_id = ?',
  ).get(pending.client_id) as { client_name: string; client_id: string } | undefined;

  const jar = await cookies();
  const csrf = jar.get(OAUTH_CSRF_COOKIE)?.value || '';
  if (!csrf) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] p-6">
        <h1 className="text-xl font-bold">認可セッションが無効です</h1>
        <p className="mt-2">もう一度エージェント側から接続をやり直してください。</p>
      </main>
    );
  }

  let scopes: string[] = [];
  try {
    scopes = JSON.parse(pending.scopes) as string[];
  } catch {
    scopes = [];
  }

  return (
    <OAuthConsentClient
      pendingId={pendingId}
      csrf={csrf}
      clientName={client?.client_name || pending.client_id}
      clientId={pending.client_id}
      scopes={scopes}
      resource={pending.resource}
      redirectUri={pending.redirect_uri}
    />
  );
}
