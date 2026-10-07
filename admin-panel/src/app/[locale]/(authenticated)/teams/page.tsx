import { notFound, redirect } from 'next/navigation';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

export default async function LegacyTeamsPage({ params }: { params: Promise<{ locale: string }> }): Promise<never> {
  const { locale } = await params;
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('team:list');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const target = resolveLegacyRedirect(locale, '/teams', effective);
  if (!target) notFound();
  redirect(target);
}
