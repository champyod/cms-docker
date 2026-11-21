import { notFound, redirect } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import { parseRecordId } from '@/lib/queries/record-access';

async function authorizeContestLanding(): Promise<void> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('contest:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === 'contests.record');
  if (!route || !route.enabled || !isRoutePermitted(route, effective)) notFound();
}

export default async function ContestDetailLanding({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestLanding();
  redirect(buildRoute(locale, 'contests.tabs.overview', { id: contestId }));
}
