import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
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

// The page resolves the registry route itself so a disabled or narrowed descriptor 404s before the data is read.
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

/** The dataset acting as the task's live one, or the missing word when none is set. */
function activeDatasetName(
  data: { activeDatasetId: number | null; datasets: readonly { id: number; description: string }[] },
  notSet: string,
): string {
  if (data.activeDatasetId === null) return notSet;
  return data.datasets.find((dataset) => dataset.id === data.activeDatasetId)?.description ?? notSet;
}

export default async function TaskDatasetsPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.datasets');
  const dictionary = await getDictionary(locale);
  const facts = dictionary.tasks.datasets;
  const data = await readRecordOrNotFound(() => getTaskDatasets(taskId));
  // Both numbers come from the same projection, so a second read could disagree with the rows.
  const testcases = data.datasets.reduce((total, dataset) => total + dataset.testcases.length, 0);
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: facts.datasets, value: formatCount(data.datasets.length, locale) },
        { term: facts.activeDataset, value: activeDatasetName(data, dictionary.common.notSet) },
        { term: facts.testcases, value: formatCount(testcases, locale) },
      ]}
    >
      <TaskDatasetsTab data={data} />
    </DetailPage>
  );
}
