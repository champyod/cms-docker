import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getContestTasks } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { ListPage } from '@/components/patterns/ListPage';
import { ContestTasksTab } from '@/components/contests/contest-detail/ContestTasksTab';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import { countLabel } from '@/lib/format-number';

type ContestRouteProps = {
  params: Promise<{ locale: string; id: string }>;
};

// The page resolves the registry route itself so a disabled or narrowed descriptor 404s before the data is read.
async function authorizeContestTab(routeId: RouteId): Promise<ReadonlySet<string>> {
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

export default async function ContestTasksPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestTab('contests.tabs.tasks');
  const data = await readRecordOrNotFound(() => getContestTasks(contestId));
  const assigned = data.tasks.length;
  const copy = (await getDictionary(locale)).contests;
  return (
    <ListPage
      // The record shell above renders the contest's name, its trail and its tabs.
      ownsHeader={false}
      // The count is the whole assignment; the rows below narrow themselves as the operator types.
      footer={<Text variant="muted">{countLabel(assigned, copy.tasks, locale)}</Text>}
    >
      <ContestTasksTab data={data} />
    </ListPage>
  );
}
