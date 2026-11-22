import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readReviewTab, reviewHref } from '@/lib/design-home';
import { mcpResourceUrlFromHeaders } from '@/lib/agent-oauth';
import HomeClient from './HomeClient';

export default async function HomePage({ searchParams }: { searchParams: Promise<{tab?: string}> }) {
  if ((await cookies()).get('butuyokuoh-ui')?.value === 'new') {
    redirect(reviewHref('rank', readReviewTab((await searchParams).tab)));
  }
  const mcpUrl = mcpResourceUrlFromHeaders(await headers());
  return <HomeClient mcpUrl={mcpUrl} />;
}
