import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTeamSummary } from '@/lib/people-read-models';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { DetailPage } from '@/components/patterns/DetailPage';
import { leaderName } from '@/components/teams/teamColumns';
import { TeamOverviewTab } from '@/components/teams/TeamOverviewTab';
import { formatCount } from '@/lib/format-number';

// Why: the reader enforces the same keys, but the page must resolve the exact
// registry route first so a disabled or narrowed descriptor 404s before data.
async function authorizeTeamTab(routeId: RouteId): Promise<ReadonlySet<string>> {
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

export default async function TeamOverviewPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await authorizeTeamTab('people.team-tabs.overview');
  const dictionary = await getDictionary(locale);
  const summary = await readRecordOrNotFound(() => getTeamSummary(id));
  const copy = dictionary.teams.overview;
  return (
    <DetailPage
      // The record shell above renders the team's name, its trail and its tabs. This tab adds the
      // two values the edit form does not show, then the three it does.
      ownsHeader={false}
      facts={[
        { term: copy.leader, value: leaderName(summary, dictionary.common.notSet) },
        { term: copy.members, value: formatCount(summary.participationCount, locale) },
      ]}
    >
      <TeamOverviewTab
        team={summary}
        permissionKeys={[...effective]}
        copy={dictionary.teams}
        locale={locale as 'en' | 'th'}
      />
    </DetailPage>
  );
}
