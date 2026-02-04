import { checkPermission } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { ContainersClient } from '@/components/containers/ContainersClient';

export default async function ContainersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!await checkPermission('all', false)) {
    redirect(`/${locale}`);
  }

  return <ContainersClient />;
}
