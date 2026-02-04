import { getContests } from '@/app/actions/contests';
import { ContestList } from '@/components/contests/ContestList';
import { getDictionary } from '@/i18n';
import { checkPermission } from '@/lib/permissions';
import { PermissionDenied } from '@/components/PermissionDenied';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default async function ContestsPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; search?: string }>;
}) {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('contests', false);

  if (!hasPermission) {
    return <PermissionDenied permission="permission_contests" locale={locale} dict={dict} />;
  }

  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';

  const { contests, totalPages } = await getContests({ page, search });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">Contests Management</Text>
        <Text variant="muted">Create and manage programming contests.</Text>
      </Stack>

      <ContestList initialContests={contests} totalPages={totalPages} />
    </Stack>
  );
}
