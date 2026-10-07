import { BackupRestoreClient } from '@/components/backup-restore/BackupRestoreClient';
import { listBackupLocations, resolveDefaultLocationId } from '@/lib/backup-locations';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';

export default async function SystemBackupRestorePage({
  params,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
}): Promise<React.JSX.Element> {
  await params;
  const effective = await authorizeRoutePage('system.backup-restore');
  const locations = listBackupLocations();
  return (
    <BackupRestoreClient
      permissionKeys={[...effective]}
      locations={locations.map((location) => ({ id: location.id, label: location.label }))}
      defaultLocationId={resolveDefaultLocationId(locations)}
    />
  );
}
