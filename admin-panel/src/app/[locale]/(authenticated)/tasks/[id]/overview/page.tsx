import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { formatCount } from '@/lib/format-number';
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
  const { locale, id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.overview');
  const dictionary = await getDictionary(locale);
  const facts = dictionary.tasks.overview.facts;
  const data = await readRecordOrNotFound(() => getTaskOverview(taskId));
  return (
    <DetailPage
      // The record shell above renders the task's name, its trail and its tabs, and the tab rail
      // already says Overview, so this page adds only the values and the statements under them.
      ownsHeader={false}
      facts={[
        { term: facts.scoreMode, value: humanize(data.task.score_mode) },
        { term: facts.feedback, value: humanize(data.task.feedback_level) },
        // Why a word and not a dash: a null precision is a task that never set one, not a 0, and
        // DESIGN.md 19 bans the em dash from anything a reader sees.
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

