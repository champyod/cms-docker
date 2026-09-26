import { notFound } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import type { RouteId } from '@/lib/navigation/types';
import { getDictionary } from '@/i18n';
import { getUserProfile, getUserSummary } from '@/lib/people-read-models';
import { readRecordOrNotFound, parseRecordId } from '@/lib/queries/record-access';
import { UserProfileTab } from '@/components/users/UserProfileTab';

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

export default async function UserProfilePage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<React.JSX.Element> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  const effective = await authorizeUserTab('people.user-tabs.profile');
  const dictionary = await getDictionary(locale);
  const [profile, summary] = await Promise.all([
    readRecordOrNotFound(() => getUserProfile(id)),
    readRecordOrNotFound(() => getUserSummary(id)),
  ]);
  return <UserProfileTab profile={profile} summary={summary} navigation={dictionary.navigation} copy={dictionary.users} permissionKeys={[...effective]} />;
}
