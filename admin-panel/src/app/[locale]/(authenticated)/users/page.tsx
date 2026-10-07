import { redirect, notFound } from 'next/navigation';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

export default async function LegacyUsersPage({ params }: { params: Promise<{ locale: string }> }): Promise<never> {
  const { locale } = await params;
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('user:list');
  } catch (error) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const target = resolveLegacyRedirect(locale, '/users', effective);
  if (!target) notFound();
  redirect(target);
}
