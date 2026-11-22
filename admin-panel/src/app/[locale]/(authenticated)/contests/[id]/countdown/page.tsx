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
  // Why the facts carry absolute times while the clock carries the remainder: the clock behind
  // them counts down and can be paused, so it answers "how long left"; only the four stored timings
  // say when this contest actually runs, and reading them in the contest's own zone is the point.
  const zone = data.timezone ?? 'UTC';
  return (
    <DetailPage
      // The record shell above renders the contest's name, its trail and its tabs; the rail says
      // Countdown, so the tab adds the timings and the clock that counts to them.
      ownsHeader={false}
      facts={[
        { term: 'Timezone', value: data.timezone ?? 'UTC' },
        { term: 'Start', value: zoneFact(data.start, zone, dictionary.common.notSet) },
        { term: 'Stop', value: zoneFact(data.stop, zone, dictionary.common.notSet) },
        {
          term: 'Analysis',
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
