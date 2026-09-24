import { checkPermission, getPermissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { RankingClient } from '@/components/ranking/RankingClient';

export default async function RankingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;
  const hasPermission =
    (await checkPermission('ranking:list', false)) &&
    (await checkPermission('ranking:read', false));

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  return <RankingClient permissionKeys={[...(await getPermissions())]} />;
}
