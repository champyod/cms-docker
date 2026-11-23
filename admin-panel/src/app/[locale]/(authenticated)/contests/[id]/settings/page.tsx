import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getContestSettings } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { SettingsPage } from '@/components/patterns/SettingsPage';
import { ContestSettingsTab } from '@/components/contests/contest-detail/ContestSettingsTab';

type ContestRouteProps = {
  params: Promise<{ locale: string; id: string }>;
};

// Why: the reader enforces the same keys, but the page must resolve the exact
// registry route first so a disabled or narrowed descriptor 404s before data.
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

export default async function ContestSettingsPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestTab('contests.tabs.settings');
  const data = await readRecordOrNotFound(() => getContestSettings(contestId));
  return (
    <SettingsPage
      // The record shell above renders the contest's name, its trail and its tabs.
      ownsHeader={false}
      groups={[
        {
          key: 'contest',
          title: 'Contest Settings',
          description: 'How this contest presents itself, and what it lets contestants do.',
          // The toggles below change the contestant side, not the operator's screen, so the group
          // says so before the reader flips one.
          scope: 'Every contestant of this contest: nobody else.',
          children: <ContestSettingsTab data={data} />,
        },
      ]}
    />
  );
}
