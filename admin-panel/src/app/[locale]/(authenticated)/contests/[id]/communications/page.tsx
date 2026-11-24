import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/app/actions/auth';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId } from '@/lib/queries/record-access';
import { BoardPage } from '@/components/patterns/BoardPage';
import { ContestCommunicationsTab } from '@/components/contests/contest-detail/ContestCommunicationsTab';

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

export default async function ContestCommunicationsPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  const effective = await authorizeContestTab('contests.tabs.communications');
  const admin = await getCurrentUser();
  if (!admin) notFound();
  const keys = [...effective];
  return (
    <BoardPage
      // The record shell above renders the contest's name, its trail and its tabs.
      ownsHeader={false}
      sections={[
        {
          key: 'announcements',
          title: 'Announcements',
          description: 'What was published to every contestant of this contest, newest first.',
          rows: <ContestCommunicationsTab contestId={contestId} adminId={admin.id} permissionKeys={keys} panel="announcements" />,
        },
        {
          key: 'questions',
          title: 'Questions',
          description: 'What contestants asked, and the answer each one is waiting for.',
          rows: <ContestCommunicationsTab contestId={contestId} adminId={admin.id} permissionKeys={keys} panel="questions" />,
        },
      ]}
    />
  );
}
