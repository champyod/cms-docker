import { notFound } from 'next/navigation';
import { DetailSurface, type DetailSurfaceProps } from '@/components/core/DetailSurface';
import { RecordTabRefreshRegistrar } from '@/hooks/useRecordTabRefresh';
import { UserDetailFrame } from '@/components/users/UserDetailFrame';
import { UserRecordHeader } from '@/components/users/UserRecordHeader';
import type { Dictionary } from '@/lib/dictionary';
import { getDictionary } from '@/i18n';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { BreadcrumbItem, RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import { getUserSummary } from '@/lib/people-read-models';
import type { UserSummary } from '@/lib/people-read-model-types';
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

// Why: a tab the reader may not open is omitted entirely rather than rendered
// disabled, so the record rail never advertises a route that would 404.
export function buildUserTabs(
  locale: string,
  userId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record = findRoute('people.user-record');
  if (!record.enabled || !isRoutePermitted(record, effective)) notFound();
  return record.tabIds.flatMap((routeId: RouteId) => {
    const route = ROUTE_REGISTRY.find((candidate) => candidate.id === routeId);
    if (!route || !route.enabled || !isRoutePermitted(route, effective)) return [];
    return [{
      id: route.id,
      label: labelForDescriptor(dictionary, route),
      href: buildRoute(locale, route.id, { id: userId }),
    } satisfies RouteTab];
  });
}

function userRecordBreadcrumbs(
  locale: string,
  userId: number,
  dictionary: Dictionary,
): readonly BreadcrumbItem[] {
  return [
    { label: labelForDescriptor(dictionary, findRoute('people.users')), href: buildRoute(locale, 'people.users') },
    { label: labelForDescriptor(dictionary, findRoute('people.user-record')), href: buildRoute(locale, 'people.user-record', { id: userId }) },
  ];
}

async function loadUserRecord(userId: number): Promise<{
  readonly effective: ReadonlySet<string>;
  readonly summary: UserSummary;
}> {
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('user:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  return { effective, summary: await readRecordOrNotFound(() => getUserSummary(userId)) };
}

export default async function UserRecordLayout({
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
  const { effective, summary } = await loadUserRecord(id);
  const props = {
    breadcrumbs: userRecordBreadcrumbs(locale, id, dictionary),
    title: summary.username,
    description: <UserDetailFrame summary={summary} />,
    actions: <UserRecordHeader userId={summary.id} permissionKeys={[...effective]} navigation={dictionary.navigation} />,
    tabs: buildUserTabs(locale, id, effective, dictionary),
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
