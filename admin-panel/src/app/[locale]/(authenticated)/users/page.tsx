import { getUsers } from '@/app/actions/users';
import { UserList } from '@/components/users/UserList';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { prisma } from '@/lib/prisma';

export default async function UsersPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; perPage?: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('users', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const permissions = await getPermissions();
  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';
  const perPage = Number(sParams.perPage) || 20;

  const { users, totalPages, currentPage, perPage: safePerPage } = await getUsers({ page, search, perPage });
  const contests = await prisma.contests.findMany({
    select: { id: true, name: true },
    orderBy: { id: 'desc' },
  });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.users.title}</Text>
        <Text variant="muted">{dict.users.subtitle}</Text>
      </Stack>

      <UserList
        initialUsers={users}
        totalPages={totalPages}
        currentPage={currentPage}
        perPage={safePerPage}
        initialSearch={search}
        contests={contests}
        permissions={permissions}
      />
    </Stack>
  );
}
