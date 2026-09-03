import { checkPermission } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { DeploymentsClient } from '@/components/deployments/DeploymentsClient';

export default async function DeploymentsPage({
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

  return <DeploymentsClient />;
}
