import { notFound, redirect } from 'next/navigation';

import { getRoutePermissions } from '@/lib/navigation/page-authorization';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError } from '@/lib/server/authorization';

const LEGACY_PATH = '/audit';

/**
 * Why this route still exists: the audit log keeps its own address so existing
 * bookmarks, chord history, and links survive the move into the Administration
 * module. Only a reader whose permissions fail closed is concealed; a 401 and any
 * unexpected storage failure keep propagating.
 */
export default async function AuditRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  try {
    const { locale } = await params;
    const effective = await getRoutePermissions();
    const target = resolveLegacyRedirect(locale, LEGACY_PATH, effective);
    if (target === null) notFound();
    redirect(target);
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
}
