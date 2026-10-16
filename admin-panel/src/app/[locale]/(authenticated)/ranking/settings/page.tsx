import { notFound, redirect } from 'next/navigation';

import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError } from '@/lib/server/authorization';

const MOVED_PATH = '/ranking/settings';

/**
 * Why this route still exists: the override surface moved onto the ranking users page, so this
 * address stays reachable for existing bookmarks and links instead of serving a second copy of the
 * same list. Only a reader whose permissions fail closed is concealed; a 401 and any unexpected
 * storage failure keep propagating.
 */
export default async function RankingSettingsRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  try {
    const [{ locale }, effective] = await Promise.all([params, getRoutePermissions()]);
    const target = resolveLegacyRedirect(locale, MOVED_PATH, effective);
    if (target === null) notFound();
    redirect(target);
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
