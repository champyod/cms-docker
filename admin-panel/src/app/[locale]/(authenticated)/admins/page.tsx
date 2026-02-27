import { getAdmins } from '@/app/actions/admins';
import { AdminList } from '@/components/admins/AdminList';
import { checkPermission } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { PermissionDenied } from '@/components/PermissionDenied';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function AdminsPage({
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

  const admins = await getAdmins();

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Administrators</Text>
        <Text variant="muted">Manage admin accounts and permissions.</Text>
      </Stack>

      <AdminList initialAdmins={admins} />
    </Stack>
  );
}
