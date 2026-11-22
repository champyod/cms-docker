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
  const label = dictionary.navigation.people['team-tabs'].contests.label;
  return (
    <ListPage
      // The record shell above renders the team's name, the trail and the tabs.
      ownsHeader={false}
      title={label}
      // Why no filter and no toolbar: the read returns every contest this team entered in a single
      // pass, so there is no narrower set for a filter to produce and nothing left out to page to.
      // The footer states the whole set instead, which is the only total there is.
      footer={<p className="text-sm text-muted-foreground">{`${label} (${contests.length})`}</p>}
      empty={contests.length === 0 ? <TeamContestsEmpty copy={dictionary.teams} /> : undefined}
    >
      <TeamContestsTab contests={contests} locale={locale as 'en' | 'th'} />
    </ListPage>
  );
}
