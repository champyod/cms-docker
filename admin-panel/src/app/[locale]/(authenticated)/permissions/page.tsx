import { notFound, redirect } from 'next/navigation';

import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError } from '@/lib/server/authorization';

const LEGACY_PATH = '/permissions';

function permissionsTabPath(tab: string | undefined): string {
  return tab === 'admins' || tab === 'groups'
    ? `/permissions?tab=${tab}`
    : LEGACY_PATH;
}

/**
 * Why this route still exists: the Admins and Groups sections used to share the
 * tabbed /permissions page, so the old address and its `?tab=` bookmarks stay
 * reachable. Only a reader whose permissions fail closed is concealed; a 401 and
 * any unexpected storage failure keep propagating.
 */
export default async function PermissionsRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}): Promise<never> {
  try {
    const [{ locale }, query] = await Promise.all([params, searchParams]);
    const effective = await getRoutePermissions();
    const target = resolveLegacyRedirect(locale, permissionsTabPath(query.tab), effective);
    if (target === null) notFound();
    redirect(target);
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
