import { getContests } from '@/app/actions/contests';
import { ContestList } from '@/components/contests/ContestList';
import { PageSurface } from '@/components/core/PageSurface';
import { getDictionary } from '@/i18n';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { notFound } from 'next/navigation';

export default async function ContestsPage({
  params,
  searchParams,
}: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<{ page?: string; search?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const hasPermission = await checkPermission('contest:list', false);

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
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'contests.list', dict)}
      title={dict.contests.title}
      description={dict.contests.subtitle}
    >
      <ContestList initialContests={contests} totalPages={totalPages} permissionKeys={Array.from(permissions)} />
    </PageSurface>
  );
}
