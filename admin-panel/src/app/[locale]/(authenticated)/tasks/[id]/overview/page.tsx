import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTaskOverview } from '@/lib/queries/task-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { TaskOverviewTab } from '@/components/tasks/task-detail/TaskOverviewTab';

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

/** One wording for the underscore-separated enum values the two facts below report. */
function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export default async function TaskOverviewPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.overview');
  const data = await readRecordOrNotFound(() => getTaskOverview(taskId));
  return (
    <DetailPage
      // The record shell above renders the task's name, its trail and its tabs, and the tab rail
      // already says Overview, so this page adds only the values and the statements under them.
      ownsHeader={false}
      title={data.task.title}
      facts={[
        { term: 'Score mode', value: humanize(data.task.score_mode) },
        { term: 'Feedback', value: humanize(data.task.feedback_level) },
        // Why the panel's missing mark: a null precision is a task that never set one, not a 0.
        { term: 'Score precision', value: data.task.score_precision === null ? '—' : String(data.task.score_precision) },
        { term: 'Submissions', value: String(data.task.submissions) },
      ]}
    >
      <TaskOverviewTab data={data} />
    </DetailPage>
  );
}

