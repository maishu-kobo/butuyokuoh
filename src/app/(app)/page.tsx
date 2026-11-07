import { headers } from 'next/headers';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import HomeClient from './HomeClient';

export default async function HomePage() {
  const mcpUrl = mcpResourceUrlFromHeaders(await headers());
  return <HomeClient mcpUrl={mcpUrl} />;
}
