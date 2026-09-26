import { notFound } from 'next/navigation';

import { ModuleRouteNav, type ModuleRouteNavItem } from '@/components/navigation/ModuleRouteNav';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { NAVIGATION_GROUPS, ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';
import type { RouteDescriptor } from '@/lib/navigation/types';
import { AuthorizationError } from '@/lib/server/authorization';

const GROUP_ID = 'infrastructure';

function labelForDescriptor(dict: Dictionary, descriptor: RouteDescriptor): string {
  const label = descriptor.labelKey.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, key);
  }, dict);
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error(`Missing navigation label: ${descriptor.labelKey}`);
  }
  return label;
}

// Why: a route the reader may not open is omitted rather than rendered disabled,
// so the module rail never advertises a tab that answers 404.
function permittedNavItems(
  locale: string,
  dict: Dictionary,
  effective: ReadonlySet<string>,
): ModuleRouteNavItem[] {
  const group = NAVIGATION_GROUPS.find((item) => item.id === GROUP_ID);
  return (group?.routeIds ?? []).flatMap((id) => {
    const descriptor = ROUTE_REGISTRY.find((route) => route.id === id);
    if (!descriptor?.enabled || !isRoutePermitted(descriptor, effective)) return [];
    return [{
      id,
      label: labelForDescriptor(dict, descriptor),
      href: buildRoute(locale, id),
    }];
  });
}

// Why conceal: the shell loads permissions to build its own rail, so a caller
// whose permissions fail closed must not learn the module exists. A 401 and any
// unexpected storage failure keep propagating.
async function concealedPermissions(): Promise<ReadonlySet<string>> {
  try {
    return await getRoutePermissions();
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}

export default async function InfrastructureLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const [dict, effective] = await Promise.all([
    getDictionary(locale),
    concealedPermissions(),
  ]);
  return (
    <>
      <ModuleRouteNav
        items={permittedNavItems(locale, dict, effective)}
        ariaLabel={dict['navigation']['groups'][GROUP_ID]}
      />
      {children}
    </>
  );
}
