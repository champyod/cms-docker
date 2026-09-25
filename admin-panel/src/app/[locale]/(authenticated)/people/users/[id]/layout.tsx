import { notFound } from 'next/navigation';
import { DetailSurface } from '@/components/core/DetailSurface';
import { UserDetailFrame } from '@/components/users/UserDetailFrame';
import type { Dictionary } from '@/lib/dictionary';
import { getDictionary } from '@/i18n';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { BreadcrumbItem, RouteDescriptor, RouteId, RouteTab } from '@/lib/navigation/types';
import { getUserSummary } from '@/lib/people-read-models';
import type { UserSummary } from '@/lib/people-read-model-types';
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

function buildUserTabs(
  locale: string,
  userId: number,
  effective: ReadonlySet<string>,
  dictionary: Dictionary,
): readonly RouteTab[] {
  const record: RouteDescriptor | undefined = ROUTE_REGISTRY.find((route) => route.id === 'people.user-record');
  if (!record || !record.enabled || !isRoutePermitted(record, effective)) notFound();
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

export default async function UserRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; id: string }>;
}): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const dictionary = await getDictionary(locale);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('user:read');
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  let summary: UserSummary | null = null;
  try {
    summary = await getUserSummary(id);
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  if (!summary) notFound();

  const usersRoute = ROUTE_REGISTRY.find((route) => route.id === 'people.users');
  const userRecordRoute = ROUTE_REGISTRY.find((route) => route.id === 'people.user-record');
  if (!usersRoute || !userRecordRoute) notFound();
  const breadcrumbs: readonly BreadcrumbItem[] = [
    { label: labelForDescriptor(dictionary, usersRoute), href: buildRoute(locale, 'people.users') },
    { label: labelForDescriptor(dictionary, userRecordRoute), href: buildRoute(locale, 'people.user-record', { id }) },
  ];
  const tabs = buildUserTabs(locale, id, effective, dictionary);
  return (
    <DetailSurface breadcrumbs={breadcrumbs} title={summary.username} description={<UserDetailFrame summary={summary} />} tabs={tabs}>
      {children}
    </DetailSurface>
  );
}
