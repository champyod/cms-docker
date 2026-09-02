import { checkPermission } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { RankingClient } from '@/components/ranking/RankingClient';

export default async function RankingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;
  const hasPermission = await checkPermission('all', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  return <RankingClient />;
}
