import { PageSurface } from '@/components/core/PageSurface';
import { getDictionary } from '@/i18n';
import { ALERT_PAGE_SIZE, getAlertHistory } from '@/lib/alert-history';
import { listBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { AlertCentre } from './AlertCentre';
import type { AlertCentreFilters } from './AlertFiltersBar';

interface NotificationsSearchParams {
  page?: string;
  search?: string;
  result?: string;
  fromDate?: string;
  toDate?: string;
}

/**
 * The alert centre: the bell's history, paged and filtered, above the alerts still on the wire.
 *
 * Why the gate is the registry's own requirement: the stream and this page read the same audit rows,
 * so a reader who may not read the log is concealed here instead of handed an empty history.
 */
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<NotificationsSearchParams>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  await authorizeRoutePage('notifications');
  const query = await searchParams;
  const page = Number(query.page) || 1;
  const filters: AlertCentreFilters = {
    search: query.search,
    result: query.result,
    fromDate: query.fromDate,
    toDate: query.toDate,
  };
  const history = await getAlertHistory({ page, ...filters });
  return (
    <PageSurface
      breadcrumbs={listBreadcrumbs(locale, 'direct', 'notifications', dict)}
      title={dict.notifications.title}
      description={dict.notifications.subtitle}
      status={
        history.success
          ? undefined
          : { kind: 'error', title: dict.notifications.loadFailed, description: history.error }
      }
    >
      {history.success && (
        <AlertCentre
          locale={locale}
          copy={dict.notifications}
          entries={history.data.entries}
          total={history.data.total}
          totalPages={history.data.totalPages}
          currentPage={page}
          pageSize={ALERT_PAGE_SIZE}
          filters={filters}
        />
      )}
    </PageSurface>
  );
}
