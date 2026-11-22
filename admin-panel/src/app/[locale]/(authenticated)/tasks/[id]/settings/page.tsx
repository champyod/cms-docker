import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTaskSettings } from '@/lib/queries/task-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { SettingsPage } from '@/components/patterns/SettingsPage';
import { TaskSettingsTab } from '@/components/tasks/task-detail/TaskSettingsTab';

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

export default async function TaskSettingsPage({ params }: TaskRouteProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskTab('tasks.tabs.settings');
  const data = await readRecordOrNotFound(() => getTaskSettings(taskId));
  return (
    <SettingsPage
      // The record shell above renders the task's name, its trail and its tabs.
      ownsHeader={false}
      title={data.task.title}
      groups={[
        {
          key: 'task',
          title: 'Task Settings',
          description: 'How this task scores a submission, and what it tells the contestant who sent it.',
          // The values below reach the contestant side and the judge, never another operator's
          // screen, so the group says so before a reader changes one.
          scope: 'Every contestant of this task, and the evaluator that scores them.',
          children: <TaskSettingsTab data={data} />,
        },
      ]}
    />
  );
}

