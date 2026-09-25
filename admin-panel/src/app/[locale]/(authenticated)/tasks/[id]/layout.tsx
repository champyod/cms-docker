import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type {
  BreadcrumbItem,
  RouteDescriptor,
  RouteId,
  RouteTab,
} from '@/lib/navigation/types';
import type { Dictionary } from '@/lib/dictionary';
import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { getTaskDetailSummary } from '@/lib/queries/task-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { TaskRecordHeader } from '@/components/tasks/TaskRecordHeader';
import { TaskTabRefreshRegistrar } from '@/components/tasks/task-detail/useTaskTabRefresh';

function getTaskTabLabel(dictionary: Dictionary, routeId: RouteId): string {
  switch (routeId) {
    case 'tasks.tabs.overview': return dictionary.navigation.tasks.tabs.overview.label;
    case 'tasks.tabs.datasets': return dictionary.navigation.tasks.tabs.datasets.label;
    case 'tasks.tabs.files': return dictionary.navigation.tasks.tabs.files.label;
    case 'tasks.tabs.settings': return dictionary.navigation.tasks.tabs.settings.label;
    default: return dictionary.navigation.tasks.record.label;
  }
}

function buildTaskTabs(
  locale: string,
  taskId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record: RouteDescriptor | undefined = ROUTE_REGISTRY.find(
    (route) => route.id === 'tasks.record',
  );
  if (!record || !record.enabled || !isRoutePermitted(record, effective)) notFound();

  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: getTaskTabLabel(dictionary, route.id),
      href: buildRoute(locale, route.id, { id: taskId }),
    } satisfies RouteTab];
  });
}

export default async function TaskDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const dictionary = await getDictionary(locale);
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();

  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('task:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }

  const summary = await readRecordOrNotFound(() => getTaskDetailSummary(taskId));
  const breadcrumbs: readonly BreadcrumbItem[] = [
    { label: dictionary.navigation.tasks.record.label, href: buildRoute(locale, 'tasks.record', { id: summary.id }) },
    { label: summary.title },
  ];
  // Why: the summary carries `id` while the header contract takes
  // `taskId`, so the record fields map explicitly instead of spreading.
  const props = {
    breadcrumbs,
    title: summary.title,
    description: summary.name,
    actions: <TaskRecordHeader taskId={summary.id} name={summary.name} title={summary.title} contest={summary.contest} permissionKeys={summary.permissionKeys} />,
    tabs: buildTaskTabs(locale, summary.id, effective, dictionary),
    children,
    className: 'space-y-6',
  } satisfies DetailSurfaceProps;
  // Why: tab action hooks refresh through a registered router instead of
  // calling useRouter where unit tests render provider-less.
  return (
    <>
      <TaskTabRefreshRegistrar />
      <DetailSurface {...props} />
    </>
  );
}
