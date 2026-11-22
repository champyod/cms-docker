import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getTeamMembers } from '@/lib/people-read-models';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { hasEffectivePermission } from '@/lib/permission-engine';
import { prisma } from '@/lib/prisma';
import { ListPage } from '@/components/patterns/ListPage';
import { TeamMembersEmpty, TeamMembersTab } from '@/components/teams/TeamMembersTab';

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

export default async function TeamMembersPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await authorizeTeamTab('people.team-tabs.members');
  const dictionary = await getDictionary(locale);
  const members = await readRecordOrNotFound(async () => ((await getTeamMembers(id)) ?? null));
  // Why contest:read gates the options: the bulk dialog targets a contest, and a
  // caller who may not list contests gets no selector rather than a leaked name.
  const contests = hasEffectivePermission(effective, 'contest:read')
    ? await prisma.contests.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })
    : [];
  const label = dictionary.navigation.people['team-tabs'].members.label;
  return (
    <ListPage
      // The record shell above renders the team's name, the trail and the tabs.
      ownsHeader={false}
      title={label}
      // Why the total sits in the footer and not beside the filter: the filter narrows the rows,
      // and a count that moved with it would answer "how many matched" when the question a roster
      // asks first is "how many members does this team have".
      footer={<p className="text-sm text-muted-foreground">{`${label} (${members.length})`}</p>}
      empty={members.length === 0
        ? (
          <TeamMembersEmpty
            teamId={id}
            permissionKeys={[...effective]}
            contests={contests}
            copy={dictionary.teams}
          />
        )
        : undefined}
    >
      <TeamMembersTab
        teamId={id}
        members={members}
        permissionKeys={[...effective]}
        contests={contests}
        copy={dictionary.teams}
        locale={locale as 'en' | 'th'}
      />
    </ListPage>
  );
}
