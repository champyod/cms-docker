import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
import { humanizeEnum } from '@/lib/format-text';
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

export default async function TaskOverviewPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.overview');
  const dictionary = await getDictionary(locale);
  const facts = dictionary.tasks.facts;
  const data = await readRecordOrNotFound(() => getTaskOverview(taskId));
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: facts.scoreMode, value: humanizeEnum(data.task.score_mode) },
        { term: facts.feedback, value: humanizeEnum(data.task.feedback_level) },
        // A null precision was never set, so it reads as a word rather than a dash or a zero.
        {
          term: facts.scorePrecision,
          value: data.task.score_precision === null ? dictionary.common.notSet : String(data.task.score_precision),
        },
        { term: facts.submissions, value: formatCount(data.task.submissions, locale) },
      ]}
    >
      <TaskOverviewTab data={data} />
    </DetailPage>
  );
}

