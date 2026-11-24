import { getAuditLog } from '@/app/actions/audit';
import { AuditFilterBar } from '@/components/audit/AuditFilterBar';
import { AuditFooter } from '@/components/audit/AuditFooter';
import { AuditTable } from '@/components/audit/AuditTable';
import type { AuditFilterValues } from '@/components/audit/auditTypes';
import { SurfaceState } from '@/components/core/SurfaceState';
import { ListPage } from '@/components/patterns/ListPage';
import { getDictionary } from '@/i18n';
import { readListSort } from '@/lib/list-sorting';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

interface AuditSearchParams {
  page?: string;
  entity?: string;
  verb?: string;
  actorId?: string;
  result?: string;
  ip?: string;
  views?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
  sort?: string;
  dir?: string;
  live?: string;
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<AuditSearchParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('administration.audit');
  const query = await searchParams;
  const page = Number(query.page) || 1;
  const sort = readListSort({ sort: query.sort, dir: query.dir });
  // The export repeats this narrowing, so the file can only describe the set the rows were read with.
  const filters: AuditFilterValues = {
    entity: query.entity,
    verb: query.verb,
    actorId: query.actorId,
    result: query.result,
    ip: query.ip,
    showViews: query.views === 'all',
    search: query.search,
    fromDate: query.fromDate,
    toDate: query.toDate,
  };
  const live = query.live === '1';
  const result = await getAuditLog({
    page,
    entity: query.entity,
    verb: query.verb,
    actorId: query.actorId,
    result: query.result,
    ip: query.ip,
    showViews: query.views === 'all',
    search: query.search,
    fromDate: query.fromDate,
    toDate: query.toDate,
    sort,
  });
  if (!result.success) {
    // A failed read is not an empty log, so the empty list is not rendered over it.
    return (
      <SurfaceState
        status={{
          kind: 'error',
          title: dict.audit.loadFailed,
          description: result.error,
        }}
      />
    );
  }
  return (
    <ListPage
      // The module shell above renders the title, the description and the trail.
      ownsHeader={false}
      toolbar={<AuditFilterBar dict={dict.audit} initial={filters} />}
      footer={
        <AuditFooter
          dict={dict.audit}
          filters={filters}
          total={result.data.total}
          currentPage={page}
          totalPages={result.data.totalPages}
          autoRefresh={live}
        />
      }
    >
      <AuditTable entries={result.data.entries} dict={dict.audit} missing={dict.common.notSet} sort={sort} autoRefresh={live} />
    </ListPage>
  );
}
