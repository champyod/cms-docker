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

/**
 * Every recorded action, one row kind, narrowed by the request.
 *
 * WHY a list: the log is one record shape read in one order, and every control on it — the filters,
 * the count, the page number — narrows or describes that one set instead of introducing a second
 * one. A board would need independent record kinds it does not have.
 *
 * WHY the filters, the footer and the table are three components: the list layout decides where each
 * sits, so each supplies its facts and none of them draws a frame of its own. The narrowing and the
 * page number live in the address, so a filtered view is a link somebody can send and keep.
 */
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
  // The narrowing the rows were read with; the controls start from it and the export repeats it, so
  // the file cannot describe a different set than the table above it.
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
    // No rows were read, so there is nothing to lay out: a list here would print "no entries" over
    // a failed read and claim the log holds none.
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
