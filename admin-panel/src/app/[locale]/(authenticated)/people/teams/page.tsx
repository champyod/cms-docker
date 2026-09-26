import { notFound } from 'next/navigation';
import { PageSurface } from '@/components/core/PageSurface';
import { TeamList } from '@/components/teams/TeamList';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor } from '@/lib/navigation/types';
import { getTeams } from '@/lib/people-read-models';
import type { TeamsPageResult } from '@/lib/people-read-model-types';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

function labelForDescriptor(dictionary: Dictionary, descriptor: RouteDescriptor): string {
  const label = descriptor.labelKey.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${descriptor.labelKey}`);
  }
  return label;
}

function teamsRouteDescriptor(): RouteDescriptor {
  const teamsRoute = ROUTE_REGISTRY.find((route) => route.id === 'people.teams');
  if (!teamsRoute) notFound();
  return teamsRoute;
}

// Why: a caller without team:list sees the concealed 404 surface, while a 401
// or an unexpected failure keeps propagating to the session and error paths.
async function loadTeamsListPage(): Promise<TeamsPageResult> {
  try {
    await requirePermission('team:list');
    return await getTeams();
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function PeopleTeamsPage({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const teamsLabel = labelForDescriptor(dict, teamsRouteDescriptor());
  const { teams, effectivePermissions } = await loadTeamsListPage();
  return (
    <PageSurface
      breadcrumbs={[{ label: teamsLabel, href: buildRoute(locale, 'people.teams') }]}
      title={teamsLabel}
      description={dict.teams.subtitle}
    >
      <TeamList
        initialTeams={teams}
        permissionKeys={[...effectivePermissions]}
        navigation={dict.navigation}
        copy={dict.teams}
        docsTitle={dict.docs.title}
      />
    </PageSurface>
  );
}
