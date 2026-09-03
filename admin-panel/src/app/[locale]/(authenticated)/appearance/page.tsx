import { checkPermission } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import { AppearanceClient } from '@/components/appearance/AppearanceClient';

export default async function AppearancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const hasPermission = await checkPermission('all', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  return <AppearanceClient locale={locale} />;
}
