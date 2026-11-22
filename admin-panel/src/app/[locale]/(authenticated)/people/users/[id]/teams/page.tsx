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
  return (
    <ListPage
      // The user's record shell renders this tab's name, the user, the trail and the tab rail.
      ownsHeader={false}
      // Why no filter, no toolbar and no count line: the read returns every membership this user
      // holds in one pass, so the table already shows the whole set and a total beneath it would
      // repeat what the reader can count.
      empty={memberships.length === 0 ? <UserTeamsEmpty copy={dictionary.users} /> : undefined}
    >
      <UserTeamsTab memberships={memberships} copy={dictionary.users} locale={locale as 'en' | 'th'} />
    </ListPage>
  );
}
