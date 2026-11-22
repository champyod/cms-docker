import { BackupRestoreClient } from '@/components/backup-restore/BackupRestoreClient';
import { ModePage } from '@/components/patterns/ModePage';
import { findDefaultLocation, listBackupLocations } from '@/lib/backup-locations';
import { BACKUP_MODES, type BackupModeId } from '@/lib/backup/modes';
import { authorizeRoutePage } from '@/lib/navigation/page-authorization';
import { hasEffectivePermission } from '@/lib/permission-engine';

const MODE_LABELS: Record<BackupModeId, { en: string; th: string }> = {
  'from-file': { en: 'From file', th: 'จากไฟล์' },
  'to-file': { en: 'To file', th: 'เป็นไฟล์' },
  'from-dir': { en: 'From backup dir', th: 'จากโฟลเดอร์สำรอง' },
  'to-dir': { en: 'To backup dir', th: 'ไปโฟลเดอร์สำรอง' },
  schedules: { en: 'Schedules', th: 'ตารางเวลา' },
};

export default async function SystemBackupRestorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: 'en' | 'th' }>;
  searchParams: Promise<{ mode?: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const { mode } = await searchParams;
  const effective = await authorizeRoutePage('system.backup-restore');
  const [locations, defaultLocation] = await Promise.all([listBackupLocations(), findDefaultLocation()]);

  const readable = BACKUP_MODES.filter((entry) => entry.anyOf.some((key) => hasEffectivePermission(effective, key)));
  const unavailable = BACKUP_MODES.filter((entry) => !readable.includes(entry)).map((entry) => ({
    label: MODE_LABELS[entry.id][locale],
    // A mode that vanished reads as a missing feature; naming the permission says who can open it.
    reason: `needs ${entry.anyOf.join(' or ')}`,
  }));

  // The address decides the mode. An unknown or forbidden mode falls back to the first one this
  // account can open, rather than rendering a workflow it holds no permission for.
  const activeMode = readable.find((entry) => entry.id === mode)?.id ?? readable[0]?.id ?? BACKUP_MODES[0].id;

  return (
    <ModePage
      ownsHeader={false}
      modes={readable.map((entry) => ({
        key: entry.id,
        label: MODE_LABELS[entry.id][locale],
        href: `?mode=${entry.id}`,
      }))}
      activeKey={activeMode}
      unavailable={unavailable}
    >
      <BackupRestoreClient
        permissionKeys={[...effective]}
        locations={locations.map((location) => ({ id: location.id, label: location.label }))}
        defaultLocationId={defaultLocation?.id ?? locations[0]?.id}
        activeMode={activeMode}
      />
    </ModePage>
  );
}
