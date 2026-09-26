import { getAuditLog } from '@/app/actions/audit';
import { AuditTable } from '@/components/audit/AuditTable';
import { PageSurface } from '@/components/core/PageSurface';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

interface AuditSearchParams {
  page?: string;
  entity?: string;
  verb?: string;
  actorId?: string;
  result?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

function auditBreadcrumbs(dict: Dictionary): { label: string }[] {
  return [
    { label: dict['navigation']['groups']['administration'] },
    { label: dict['navigation']['administration']['audit']['label'] },
  ];
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
  const effective = await authorizeRoutePage('administration.audit');
  const query = await searchParams;
  const page = Number(query.page) || 1;
  const result = await getAuditLog({
    page,
    entity: query.entity,
    verb: query.verb,
    actorId: query.actorId,
    result: query.result,
    search: query.search,
    fromDate: query.fromDate,
    toDate: query.toDate,
  });
  return (
    <PageSurface
      breadcrumbs={auditBreadcrumbs(dict)}
      title={dict['navigation']['administration']['audit']['label']}
      description={dict.audit.subtitle}
      status={result.success ? { kind: 'idle' } : {
        kind: 'error',
        title: dict.audit.loadFailed,
        description: result.error,
      }}
    >
      {result.success ? (
        <AuditTable
          entries={result.data.entries}
          total={result.data.total}
          totalPages={result.data.totalPages}
          currentPage={page}
          filters={{
            entity: query.entity,
            verb: query.verb,
            actorId: query.actorId,
            result: query.result,
            search: query.search,
            fromDate: query.fromDate,
            toDate: query.toDate,
          }}
          dict={dict.audit}
          permissionKeys={[...effective]}
        />
      ) : null}
    </PageSurface>
  );
}
