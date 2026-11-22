import { headers } from 'next/headers';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import { readReviewView, reviewHref } from '@/lib/design-home';
import SettingsClient from './SettingsClient';

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{from?: string}> }) {
  const mcpUrl = mcpResourceUrlFromHeaders(await headers());
  const { from } = await searchParams;
  return <SettingsClient mcpUrl={mcpUrl} back={from ? reviewHref(readReviewView(from)) : '/'} />;
}
