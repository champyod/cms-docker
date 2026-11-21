import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/app/actions/auth';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { parseRecordId } from '@/lib/queries/record-access';
import { ContestCommunicationsTab } from '@/components/contests/contest-detail/ContestCommunicationsTab';

type ContestRouteProps = {
  params: Promise<{ locale: string; id: string }>;
};

// Why: the communications reader is client-fetched, but the page still gates
// every all-of read key first so announcements, questions, and ranking stay
// hidden from partial readers before any admin identity resolves.
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

export default async function ContestCommunicationsPage({ params }: ContestRouteProps) {
  const { id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  const effective = await authorizeContestTab('contests.tabs.communications');
  const admin = await getCurrentUser();
  if (!admin) notFound();
  return <ContestCommunicationsTab contestId={contestId} adminId={admin.id} permissionKeys={[...effective]} />;
}
