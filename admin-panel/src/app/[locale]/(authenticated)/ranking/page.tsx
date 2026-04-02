import { getDictionary } from '@/i18n';
import { checkPermission } from '@/lib/permissions';
import { PermissionDenied } from '@/components/PermissionDenied';
import { RankingClient } from '@/components/ranking/RankingClient';

export default async function RankingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('all', false);

  if (!hasPermission) {
    return <PermissionDenied permission="permission_all" locale={locale} dict={dict} />;
  }

  return <RankingClient />;
}
