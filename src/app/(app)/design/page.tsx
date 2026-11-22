import { headers } from 'next/headers';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import HomeClient from '../HomeClient';

export const metadata = { title: 'ほしいものリスト | 物欲王' };

export default async function DesignPage() {
  return <HomeClient designReview mcpUrl={mcpResourceUrlFromHeaders(await headers())} />;
}
