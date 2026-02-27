import { getUsers } from '@/app/actions/users';
import { UserList } from '@/components/users/UserList';
import { getDictionary } from '@/i18n';
import { checkPermission } from '@/lib/permissions';
import { PermissionDenied } from '@/components/PermissionDenied';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function UsersPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('users', false);

  if (!hasPermission) {
    return <PermissionDenied permission="permission_users" locale={locale} dict={dict} />;
  }

  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';

  const { users, totalPages } = await getUsers({ page, search });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">User Management</Text>
        <Text variant="muted">Manage system users and participants.</Text>
      </Stack>

      <UserList initialUsers={users} totalPages={totalPages} />
    </Stack>
  );
}
