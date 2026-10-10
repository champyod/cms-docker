import { notFound, redirect } from 'next/navigation';

import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError } from '@/lib/server/authorization';

const LEGACY_PATH = '/infrastructure/ranking';

/**
 * Why this route still exists: the ranking screen moved into its own Ranking group,
 * so the old address stays reachable for existing bookmarks, chord history and links.
 * Only a reader whose permissions fail closed is concealed; a 401 and any unexpected
 * storage failure keep propagating.
 */
export default async function InfrastructureRankingRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  try {
    const [{ locale }, effective] = await Promise.all([params, getRoutePermissions()]);
    const target = resolveLegacyRedirect(locale, LEGACY_PATH, effective);
    if (target === null) notFound();
    redirect(target);
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
