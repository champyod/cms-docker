import { notFound, redirect } from 'next/navigation';

import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError } from '@/lib/server/authorization';

const LEGACY_PATH = '/deployments';

/**
 * Why this route still exists: the Deployments screen keeps its old address so
 * existing bookmarks, chord history, and links land on the canonical module
 * route. Only a reader whose permissions fail closed is concealed; a 401 and any
 * unexpected storage failure keep propagating.
 */
export default async function DeploymentsRedirectPage({
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
