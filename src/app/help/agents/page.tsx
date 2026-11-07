import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import AgentHelpContent from './AgentHelpContent';

export const metadata: Metadata = {
  title: 'エージェント連携 - 物欲王',
};

export default async function AgentHelpPage() {
  const mcpUrl = mcpResourceUrlFromHeaders(await headers());
  return <AgentHelpContent mcpUrl={mcpUrl} />;
}
