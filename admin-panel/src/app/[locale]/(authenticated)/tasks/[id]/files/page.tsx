import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTaskFiles } from '@/lib/queries/task-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { TaskFilesTab } from '@/components/tasks/task-detail/TaskFilesTab';

type TaskRouteProps = {
  params: Promise<{ locale: string; id: string }>;
};

// Why: the reader enforces the same keys, but the page must resolve the exact
// registry route first so a disabled or narrowed descriptor 404s before data.
async function authorizeTaskTab(routeId: RouteId): Promise<ReadonlySet<string>> {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route || !route.enabled) notFound();
  try {
    let effective: ReadonlySet<string> = new Set<string>();
    for (const key of route.permission.all ?? []) effective = await requirePermission(key);
    if (!isRoutePermitted(route, effective)) notFound();
    return effective;
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function TaskFilesPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.files');
  const dictionary = await getDictionary(locale);
  const data = await readRecordOrNotFound(() => getTaskFiles(taskId));
  return (
    <DetailPage
      // The record shell above renders the task's name, its trail and its tabs; the rail says Files,
      // so this page states how many files the task carries and leaves the list to the tab.
      ownsHeader={false}
      facts={[
        { term: dictionary.tasks.files.attachments, value: formatCount(data.attachments.length, locale) },
      ]}
    >
      <TaskFilesTab data={data} />
    </DetailPage>
  );
}
