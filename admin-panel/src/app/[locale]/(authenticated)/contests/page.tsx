import { getContests } from '@/app/actions/contests';
import { ContestList } from '@/components/contests/ContestList';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { getDictionary } from '@/i18n';
import { notFound } from 'next/navigation';
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

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!hasPermission) {
    notFound();
  }

  const permissions = await getPermissions();
  const sParams = await searchParams;
  const page = Number(sParams.page) || 1;
  const search = sParams.search || '';

  const { contests, totalPages } = await getContests({ page, search });

  return (
    <Stack gap={8}>
      <Stack gap={2}>
        <Text variant="h1">{dict.contests.title}</Text>
        <Text variant="muted">{dict.contests.subtitle}</Text>
      </Stack>

      <ContestList initialContests={contests} totalPages={totalPages} permissions={permissions} />
    </Stack>
  );
}
