import { notFound, redirect } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { buildRoute } from '@/lib/navigation/routes';
import { parseRecordId } from '@/lib/queries/record-access';

export default async function LegacyTeamDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<never> {
  const { locale, id: rawId } = await params;
  const id = parseRecordId(rawId);
  if (id === null) notFound();
  // Why: a bookmark without team:read sees the concealed 404 surface instead of
  // a redirect that would advertise the canonical record.
  try {
    await requirePermission('team:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  redirect(buildRoute(locale, 'people.team-record', { id }));
}
