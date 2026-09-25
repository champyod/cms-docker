import { notFound, redirect } from 'next/navigation';
import { AuthorizationError, requirePermission } from '@/lib/server/authorization';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { ROUTE_REGISTRY } from '@/lib/navigation/registry';
import { buildRoute } from '@/lib/navigation/routes';

export default async function UserRecordLanding({ params }: { params: Promise<{ locale: string; id: string }> }): Promise<never> {
  const { locale, id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();
  let effective: ReadonlySet<string>;
  try {
    effective = await requirePermission('user:read');
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.status === 403) notFound();
    throw error;
  }
  const record = ROUTE_REGISTRY.find((route) => route.id === 'people.user-record');
  if (!record || !record.enabled || !isRoutePermitted(record, effective)) notFound();
  if (!record.defaultChildId) notFound();
  redirect(buildRoute(locale, record.defaultChildId, { id }));
}
