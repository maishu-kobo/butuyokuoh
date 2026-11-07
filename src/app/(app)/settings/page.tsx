import { headers } from 'next/headers';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import SettingsClient from './SettingsClient';

export default async function SettingsPage() {
  const mcpUrl = mcpResourceUrlFromHeaders(await headers());
  return <SettingsClient mcpUrl={mcpUrl} />;
}
