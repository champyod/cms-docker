import { checkPermission, getPermissions } from '@/lib/permissions';
import { notFound } from 'next/navigation';
import MaintenanceClient from './MaintenanceClient';

export default async function MaintenancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;
  // Why OR: backup operators (backup:create, no maintenance:update) must reach
  // the backup controls; full maintainers keep access via maintenance:update.
  const canConfigure = await checkPermission('maintenance:update', false);
  const canBackUp = await checkPermission('backup:create', false);

  // Why: return 404 for forbidden access so existence is indistinguishable from missing page
  if (!canConfigure && !canBackUp) {
    notFound();
  }

  const permissions = await getPermissions();
  return <MaintenanceClient permissionKeys={Array.from(permissions)} />;
}
