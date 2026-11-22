import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getDictionary } from '@/i18n';
import { getUserTeams } from '@/lib/people-read-models';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { ListPage } from '@/components/patterns/ListPage';
import { UserTeamsEmpty, UserTeamsTab } from '@/components/users/UserTeamsTab';

async function authorizeUserTab(routeId: RouteId): Promise<ReadonlySet<string>> {
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

export default async function UserTeamsPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  await authorizeUserTab('people.user-tabs.teams');
  const dictionary = await getDictionary(locale);
  const memberships = await readRecordOrNotFound(async () => ((await getUserTeams(id)) ?? null));
  const label = dictionary.navigation.people['user-tabs'].teams.label;
  return (
    <ListPage
      // The record shell above renders the user's name, the trail and the tabs.
      ownsHeader={false}
      title={label}
      // Why no filter and no toolbar: the read returns every membership this user holds in one
      // pass, so there is no narrower set a filter could produce and nothing left out to page to.
      // The footer states the whole set instead, which is the only total there is.
      footer={<p className="text-sm text-muted-foreground">{`${label} (${memberships.length})`}</p>}
      empty={memberships.length === 0 ? <UserTeamsEmpty copy={dictionary.users} /> : undefined}
    >
      <UserTeamsTab memberships={memberships} copy={dictionary.users} locale={locale as 'en' | 'th'} />
    </ListPage>
  );
}
