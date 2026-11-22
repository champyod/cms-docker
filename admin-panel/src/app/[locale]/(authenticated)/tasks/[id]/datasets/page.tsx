import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTaskDatasets } from '@/lib/queries/task-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { TaskDatasetsTab } from '@/components/tasks/task-detail/TaskDatasetsTab';

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

/** The dataset acting as the task's live one, or the panel's missing mark when none is set. */
function activeDatasetName(data: { activeDatasetId: number | null; datasets: readonly { id: number; description: string }[] }): string {
  if (data.activeDatasetId === null) return '—';
  return data.datasets.find((dataset) => dataset.id === data.activeDatasetId)?.description ?? '—';
}

export default async function TaskDatasetsPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.datasets');
  const data = await readRecordOrNotFound(() => getTaskDatasets(taskId));
  // Why the testcase count over the datasets array rather than a second read: both numbers come from
  // the same projection, so a count that could disagree with the rows is a count nobody can check.
  const testcases = data.datasets.reduce((total, dataset) => total + dataset.testcases.length, 0);
  return (
    <DetailPage
      // The record shell above renders the task's name, its trail and its tabs; the rail says
      // Datasets, so this page states which datasets exist and how the live one is chosen.
      ownsHeader={false}
      title={`Task #${data.taskId}`}
      facts={[
        { term: 'Datasets', value: String(data.datasets.length) },
        { term: 'Active dataset', value: activeDatasetName(data) },
        { term: 'Testcases', value: String(testcases) },
      ]}
    >
      <TaskDatasetsTab data={data} />
    </DetailPage>
  );
}
