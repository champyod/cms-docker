import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { resolveContestPhase } from '@/lib/contest-countdown';
import { getContestOverview } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { ContestOverviewTab } from '@/components/contests/contest-detail/ContestOverviewTab';

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

export default async function ContestOverviewPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const dictionary = await getDictionary(locale);
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestTab('contests.tabs.overview');
  const data = await readRecordOrNotFound(() => getContestOverview(contestId));
  const { contest } = data;
  const copy = dictionary.contests;
  return (
    <DetailPage
      // The record shell above renders the contest's name, its trail and its tabs, so this tab adds
      // only what the four editable timings below cannot say: where the contest stands right now,
      // and which zone those timings are read in.
      ownsHeader={false}
      facts={[
        { term: copy.overview.facts.state, value: copy.phases[resolveContestPhase(contest, new Date())] },
        { term: copy.overview.facts.timezone, value: contest.timezone ?? dictionary.common.notSet },
      ]}
    >
      <ContestOverviewTab data={data} />
    </DetailPage>
  );
}
