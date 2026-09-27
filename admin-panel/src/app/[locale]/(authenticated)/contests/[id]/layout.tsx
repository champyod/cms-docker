import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { recordBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import type { Dictionary } from '@/lib/dictionary';
import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { getContestDetailSummary } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { ContestRecordHeader } from '@/components/contests/contest-detail/ContestRecordHeader';
import { RecordTabRefreshRegistrar } from '@/hooks/useRecordTabRefresh';

function getContestTabLabel(dictionary: Dictionary, routeId: RouteId): string {
  switch (routeId) {
    case 'contests.tabs.overview': return dictionary.navigation.contests.tabs.overview.label;
    case 'contests.tabs.tasks': return dictionary.navigation.contests.tabs.tasks.label;
    case 'contests.tabs.participants': return dictionary.navigation.contests.tabs.participants.label;
    case 'contests.tabs.communications': return dictionary.navigation.contests.tabs.communications.label;
    case 'contests.tabs.settings': return dictionary.navigation.contests.tabs.settings.label;
    default: return dictionary.navigation.contests.record.label;
  }
}

function buildContestTabs(
  locale: string,
  contestId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record: RouteDescriptor | undefined = ROUTE_REGISTRY.find(
    (route) => route.id === 'contests.record',
  );
  if (!record || !record.enabled || !isRoutePermitted(record, effective)) notFound();

  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: getContestTabLabel(dictionary, route.id),
      href: buildRoute(locale, route.id, { id: contestId }),
    } satisfies RouteTab];
  });
}

export default async function ContestDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const dictionary = await getDictionary(locale);
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();

  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('contest:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }

  const summary = await readRecordOrNotFound(() => getContestDetailSummary(contestId));
  const props = {
    breadcrumbs: recordBreadcrumbs(locale, 'direct', 'contests.record', 'contests.list', dictionary),
    title: summary.name,
    description: summary.description,
    actions: <ContestRecordHeader contestId={summary.id} name={summary.name} description={summary.description} isActive={summary.is_active} permissionKeys={summary.permissionKeys} />,
    tabs: buildContestTabs(locale, summary.id, effective, dictionary),
    children,
    className: 'space-y-6',
  } satisfies DetailSurfaceProps;
  // Why: tab action hooks refresh through a registered router instead of
  // calling useRouter where unit tests render provider-less.
  return (
    <>
      <RecordTabRefreshRegistrar />
      <DetailSurface {...props} />
    </>
  );
}
