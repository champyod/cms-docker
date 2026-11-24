'use client';

import { Zap } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Input } from '@/components/core/Input';
import { useFormatTimestamp } from '@/components/layout/TimezoneProvider';
import { useMaintenance } from '@/components/system/MaintenanceSurface';

const BACKUP_FIELDS = [
  { key: 'BACKUP_INTERVAL_MINS', label: 'Backup Interval (min)', placeholder: '1440 (24h)' },
  { key: 'BACKUP_MAX_COUNT', label: 'Max Count', placeholder: '50' },
  { key: 'BACKUP_MAX_AGE_DAYS', label: 'Max Age (days)', placeholder: '10' },
  { key: 'BACKUP_MAX_SIZE_GB', label: 'Storage Limit (GB)', placeholder: '5' },
] as const;

function formatArchiveSize(sizeBytes: number): string {
  return `${(sizeBytes / 1048576).toFixed(1)} MB`;
}

function ArchiveList(): React.JSX.Element {
  const { archives, archivesLoading } = useMaintenance();
  // Why: an archive is a property of the machine, not of a contest, so it has no owner zone.
  const formatTimestamp = useFormatTimestamp();
  if (archives.length === 0 && !archivesLoading) {
    return <Text variant="small" color="text-muted-foreground">No archives found.</Text>;
  }
  return (
    <>
      {archives.map((archive) => (
        <div key={archive.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono truncate">{archive.name}</span>
          <span className="text-muted-foreground shrink-0">
            {formatArchiveSize(archive.sizeBytes)}, {formatTimestamp(archive.modifiedIso)}
          </span>
        </div>
      ))}
    </>
  );
}

export function MaintenanceBackupsCard(): React.JSX.Element {
  const { data, handleChange, handleBackup, backingUp, canTriggerBackup, canViewBackups, archives, archivesLoading } = useMaintenance();
  return (
    <Stack gap={6}>
      <Stack gap={4}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {BACKUP_FIELDS.slice(0, 2).map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="number"
              value={data[field.key] || ''}
              onChange={(event) => handleChange(field.key, event.target.value)}
              placeholder={field.placeholder}
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {BACKUP_FIELDS.slice(2).map((field) => (
            <Input
              key={field.key}
              label={field.label}
              type="number"
              value={data[field.key] || ''}
              onChange={(event) => handleChange(field.key, event.target.value)}
              placeholder={field.placeholder}
            />
          ))}
        </div>
      </Stack>

      {canTriggerBackup && (
        <Stack gap={2} className="border-t border-border pt-4">
          <Button
            variant="positiveOutline"
            className="w-full"
            onClick={() => { void handleBackup(); }}
            loading={backingUp}
          >
            <Zap className="w-4 h-4" />
            Trigger Manual Backup Now
          </Button>
          <Text variant="small" color="text-muted-foreground" className="text-center italic opacity-50">
            Manual backups also respect cleanup policies.
          </Text>
        </Stack>
      )}
      {canViewBackups && (
        <Stack gap={2} className="border-t border-border pt-4">
          <Text variant="h4">
            Archives ({archivesLoading ? '…' : archives.length})
          </Text>
          <ArchiveList />
        </Stack>
      )}
    </Stack>
  );
}
