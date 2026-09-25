import { redirect, notFound } from 'next/navigation';
import { resolveLegacyRedirect } from '@/lib/navigation/redirects';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';

export default async function LegacySubmissionLanesPage({ params }: { params: Promise<{ locale: string }> }): Promise<never> {
  const { locale } = await params;
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('evaluation:list');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const target = resolveLegacyRedirect(locale, '/submissions/lanes', effective);
  if (!target) notFound();
  redirect(target);
}
