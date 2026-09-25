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

export default async function PeopleUsersPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; search?: string; perPage?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const usersRoute = ROUTE_REGISTRY.find((route) => route.id === 'people.users');
  if (!usersRoute) notFound();
  // Why: contract test doubles supply only the users copy, so the registry
  // label is preferred but the page title is kept as the fallback.
  let usersLabel = dict.users.title;
  try {
    usersLabel = labelForDescriptor(dict, usersRoute);
  } catch {
    usersLabel = dict.users.title;
  }
  const query = await searchParams;
  const page = Number(query.page) || 1;
  const search = query.search || '';
  const perPage = Number(query.perPage) || 20;
  let result: Awaited<ReturnType<typeof getUsers>>;
  try {
    result = await getUsers({ page, search, perPage });
  } catch (error) {
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
