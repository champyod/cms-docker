import { notFound, redirect } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import { parseRecordId } from '@/lib/queries/record-access';

async function authorizeTaskLanding(): Promise<void> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('task:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === 'tasks.record');
  if (!route || !route.enabled || !isRoutePermitted(route, effective)) notFound();
}

export default async function TaskDetailLanding({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const taskId = parseRecordId(id);
  if (taskId === null) notFound();
  await authorizeTaskLanding();
  redirect(buildRoute(locale, 'tasks.tabs.overview', { id: taskId }));
}
