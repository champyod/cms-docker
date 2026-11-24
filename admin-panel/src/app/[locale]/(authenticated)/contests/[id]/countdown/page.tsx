import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getContestCountdown } from '@/lib/queries/contest-detail';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { ContestCountdownTab } from '@/components/contests/contest-detail/ContestCountdownTab';
import { resolveCountdownAmbientConfig } from '@/lib/contest-ambient-config';
import { formatZoneTime } from '@/lib/contest-countdown';

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

/** One timing in the zone the contest is read in, or the panel's missing mark. */
function zoneFact(value: string | null, timeZone: string, missing: string): string {
  return value === null ? missing : formatZoneTime(new Date(value), timeZone);
}

export default async function ContestCountdownPage({ params }: ContestRouteProps): Promise<React.JSX.Element> {
  const { locale, id } = await params;
  const dictionary = await getDictionary(locale);
  const contestId = parseRecordId(id);
  if (contestId === null) notFound();
  await authorizeContestTab('contests.tabs.countdown');
  const data = await readRecordOrNotFound(() => getContestCountdown(contestId));
  // The clock can be paused, so only the four stored timings say when the contest actually runs.
  const zone = data.timezone ?? 'UTC';
  const copy = dictionary.contests.countdown.facts;
  return (
    <DetailPage
      ownsHeader={false}
      facts={[
        { term: copy.timezone, value: data.timezone ?? dictionary.common.notSet },
        { term: copy.start, value: zoneFact(data.start, zone, dictionary.common.notSet) },
        { term: copy.stop, value: zoneFact(data.stop, zone, dictionary.common.notSet) },
        {
          term: copy.analysis,
          value: data.analysis_start === null || data.analysis_stop === null
            ? dictionary.common.notSet
            : `${zoneFact(data.analysis_start, zone, dictionary.common.notSet)} → ${zoneFact(data.analysis_stop, zone, dictionary.common.notSet)}`,
        },
      ]}
    >
      {/* The tuning is read here rather than in the Client Component, so the values are the
          deployment's own and not a build-time constant baked into the browser bundle. */}
      <ContestCountdownTab data={data} ambientConfig={resolveCountdownAmbientConfig()} />
    </DetailPage>
  );
}
