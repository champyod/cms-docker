import { getContests } from '@/app/actions/contests';
import { ContestList } from '@/components/contests/ContestList';
import { ContestListHeader } from '@/components/contests/contest-list/ContestListHeader';
import { ContestListToolbar } from '@/components/contests/contest-list/ContestListToolbar';
import { RecordListPager } from '@/components/list/RecordListPager';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { readListSort } from '@/lib/list-sorting';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { buildRoute } from '@/lib/navigation/routes';
import { ACTION_PERMISSIONS, hasEffectivePermission } from '@/lib/permission-engine';
import { checkPermission, getPermissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';

export default async function ContestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; sort?: string; dir?: string }>;
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
  const sort = readListSort({ sort: sParams.sort, dir: sParams.dir });

  const { contests, total, totalPages } = await getContests({ page, search, sort });

  // Why a link and not a click handler: the page number is part of the request, so the pager
  // produces the address of the next page and the filter and sort the reader chose survive it.
  const hrefForPage = (next: number): string => {
    const query = new URLSearchParams();
    if (search) query.set('search', search);
    if (sort) {
      query.set('sort', sort.key);
      query.set('dir', sort.direction);
    }
    if (next > 1) query.set('page', String(next));
    const suffix = query.toString();
    return `${buildRoute(locale, 'contests.list')}${suffix.length > 0 ? `?${suffix}` : ''}`;
  };

  return (
    <ListPage
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'contests.list', dict)}
      title={dict.contests.title}
      description={dict.contests.subtitle}
      actions={
        <ContestListHeader
          locale={locale}
          canCreate={hasEffectivePermission(permissions, ACTION_PERMISSIONS.createContest)}
          permissionKeys={Array.from(permissions)}
        />
      }
      toolbar={<ContestListToolbar initialSearch={search} />}
      footer={
        <RecordListPager
          currentPage={page}
          totalPages={totalPages}
          hrefForPage={hrefForPage}
          totalRows={total}
          rowLabel="contests"
        />
      }
    >
      <ContestList initialContests={contests} permissionKeys={Array.from(permissions)} initialSort={sort} />
    </ListPage>
  );
}
