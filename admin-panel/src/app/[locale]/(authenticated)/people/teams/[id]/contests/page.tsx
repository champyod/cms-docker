import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTeamContests } from '@/lib/people-read-models';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { ListPage } from '@/components/patterns/ListPage';
import { TeamContestsEmpty, TeamContestsTab } from '@/components/teams/TeamContestsTab';

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

export default async function TeamContestsPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeTeamTab('people.team-tabs.contests');
  const dictionary = await getDictionary(locale);
  const contests = await readRecordOrNotFound(async () => ((await getTeamContests(id)) ?? null));
  return (
    <ListPage
      // The team's record shell renders this tab's name, the team, the trail and the tab rail.
      ownsHeader={false}
      // Why no filter, no toolbar and no count line: the read returns every contest this team
      // entered in a single pass, so the table already shows the whole set and a total beneath it
      // would repeat what the reader can count.
      empty={contests.length === 0 ? <TeamContestsEmpty copy={dictionary.teams} /> : undefined}
    >
      <TeamContestsTab contests={contests} locale={locale as 'en' | 'th'} missing={dictionary.common.notSet} />
    </ListPage>
  );
}
