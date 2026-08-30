import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { PermissionDenied } from '@/components/PermissionDenied';
import { DeploymentsClient } from '@/components/deployments/DeploymentsClient';

export default async function DeploymentsPage({
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

  return <DeploymentsClient />;
}
