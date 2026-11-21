import { notFound } from 'next/navigation';
import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { RecordTabRefreshRegistrar } from '@/hooks/useRecordTabRefresh';
import { TeamRecordHeader } from '@/components/teams/TeamRecordHeader';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { recordBreadcrumbs } from '@/lib/navigation/breadcrumbs';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import { getTeamSummary } from '@/lib/people-read-models';
import type { TeamSummary } from '@/lib/people-read-model-types';
import { parseRecordId, readRecordOrNotFound } from '@/lib/queries/record-access';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

function labelForKey(dictionary: Dictionary, key: string): string {
  const label = key.split('.').reduce<unknown>((value, segment) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, segment);
  }, dictionary);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${key}`);
  }
  return label;
}

function labelForDescriptor(dictionary: Dictionary, descriptor: RouteDescriptor): string {
  return labelForKey(dictionary, descriptor.labelKey);
}

function findRoute(routeId: RouteId): RouteDescriptor {
  const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
  if (!route) notFound();
  return route;
}

// Why the fallbacks: a team row may carry no name, and an empty heading is the one
// thing a record page cannot show — the name is the heading, and the next
// identifier down becomes the description so the two never repeat one word.
export function teamHeading(summary: TeamSummary): string {
  return summary.name ?? summary.code ?? `#${summary.id}`;
}

export function teamDescription(summary: TeamSummary): string | null {
  const heading = teamHeading(summary);
  return [summary.code, summary.organization].find((value) => value !== null && value !== heading) ?? null;
}

// Why: a tab the reader may not open is omitted entirely rather than rendered
// disabled, so the record rail never advertises a route that would 404.
export function buildTeamTabs(
  locale: string,
  teamId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record = findRoute('people.team-record');
  if (!record.enabled || !isRoutePermitted(record, effective)) notFound();
  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: labelForDescriptor(dictionary, route),
      href: buildRoute(locale, route.id, { id: teamId }),
    } satisfies RouteTab];
  });
}

async function loadTeamRecord(teamId: number): Promise<{
  readonly effective: ReadonlySet<string>;
  readonly summary: TeamSummary;
}> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('team:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  return { effective, summary: await readRecordOrNotFound(() => getTeamSummary(teamId)) };
}

export default async function TeamRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const dictionary = await getDictionary(locale);
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const { effective, summary } = await loadTeamRecord(id);
  const props = {
    breadcrumbs: recordBreadcrumbs(locale, 'people', 'people.team-record', 'people.teams', dictionary),
    title: teamHeading(summary),
    description: teamDescription(summary),
    actions: <TeamRecordHeader teamId={summary.id} permissionKeys={[...effective]} navigation={dictionary.navigation} />,
    tabs: buildTeamTabs(locale, id, effective, dictionary),
    children,
    className: 'space-y-6',
  } satisfies DetailSurfaceProps;
  // Why: the edit header refreshes through a registered router instead of
  // calling useRouter where unit tests render provider-less.
  return (
    <>
      <RecordTabRefreshRegistrar />
      <DetailSurface {...props} />
    </>
  );
}
