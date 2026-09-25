import { notFound } from 'next/navigation';
import { PageSurface } from '@/components/core/PageSurface';
import { getUsers } from '@/app/actions/users';
import { UserList } from '@/components/users/UserList';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor } from '@/lib/navigation/types';
import { prisma } from '@/lib/prisma';
import { AuthorizationError } from '@/lib/server/authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';

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

function usersRouteDescriptor(): RouteDescriptor {
  const usersRoute = ROUTE_REGISTRY.find((route) => route.id === 'people.users');
  if (!usersRoute) notFound();
  return usersRoute;
}

interface UsersListPage {
  readonly result: Awaited<ReturnType<typeof getUsers>>;
  readonly search: string;
  readonly contests: Array<{ id: number; name: string }>;
  readonly canReadContests: boolean;
}

// Why: contest options are a separate read from the user page, and a
// user:list-only reader must not trigger the query or receive the payload.
async function loadUsersListPage(
  searchParams: Promise<{ page?: string; search?: string; perPage?: string }>,
): Promise<UsersListPage> {
  const query = await searchParams;
  const search = query.search || '';
  let result: Awaited<ReturnType<typeof getUsers>>;
  try {
    result = await getUsers({
      page: Number(query.page) || 1,
      search,
      perPage: Number(query.perPage) || 20,
    });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const canReadContests = hasEffectivePermission(result.effectivePermissions, 'contest:read');
  const contests = canReadContests
    ? await prisma.contests.findMany({
        select: { id: true, name: true },
        orderBy: { id: 'desc' },
      })
    : [];
  return { result, search, contests, canReadContests };
}

export default async function PeopleUsersPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; perPage?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const usersLabel = labelForDescriptor(dict, usersRouteDescriptor());
  const { result, search, contests, canReadContests } = await loadUsersListPage(searchParams);
  return (
    <PageSurface
      breadcrumbs={[{ label: usersLabel, href: buildRoute(locale, 'people.users') }]}
      title={usersLabel}
      description={dict.users.subtitle}
    >
      <UserList
        initialUsers={result.users}
        totalPages={result.totalPages}
        currentPage={result.currentPage}
        perPage={result.perPage}
        initialSearch={search}
        contests={contests}
        canReadContests={canReadContests}
        navigation={dict.navigation}
        permissionKeys={[...result.effectivePermissions]}
        locale={locale as 'en' | 'th'}
      />
    </PageSurface>
  );
}
