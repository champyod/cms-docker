'use client';

import { Database, Zap } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Input } from '@/components/core/Input';
import type { MaintenanceController } from '@/components/system/maintenance-types';

const BACKUP_FIELDS = [
  { key: 'BACKUP_INTERVAL_MINS', label: 'Backup Interval (min)', placeholder: '1440 (24h)' },
  { key: 'BACKUP_MAX_COUNT', label: 'Max Count', placeholder: '50' },
  { key: 'BACKUP_MAX_AGE_DAYS', label: 'Max Age (days)', placeholder: '10' },
  { key: 'BACKUP_MAX_SIZE_GB', label: 'Storage Limit (GB)', placeholder: '5' },
] as const;

function formatArchiveSize(sizeBytes: number): string {
  return `${(sizeBytes / 1048576).toFixed(1)} MB`;
}

function ArchiveList({ controller }: { readonly controller: MaintenanceController }): React.JSX.Element {
  const { archives, archivesLoading } = controller;
  if (archives.length === 0 && !archivesLoading) {
    return <Text variant="small" color="text-muted-foreground">No archives found.</Text>;
  }
  return (
    <>
      {archives.map((archive) => (
        <div key={archive.name} className="flex items-center justify-between gap-2 text-xs">
          <span className="font-mono truncate">{archive.name}</span>
          <span className="text-muted-foreground shrink-0">
            {formatArchiveSize(archive.sizeBytes)} · {new Date(archive.modifiedIso).toLocaleString()}
          </span>
        </div>
      ))}
    </>
  );
}

export function MaintenanceBackupsCard({
  controller,
}: {
  readonly controller: MaintenanceController;
}): React.JSX.Element {
  const { data, handleChange, handleBackup, backingUp, canTriggerBackup } = controller;
  return (
    <Stack gap={6}>
      <Card className="p-6 h-full">
        <Stack direction="row" align="center" gap={3} className="mb-6">
          <div className="p-2 bg-success/10 rounded-lg">
            <Database className="w-5 h-5 text-success" />
          </div>
          <Text variant="h2">Submissions Backup</Text>
        </Stack>

        <Stack gap={6}>
          <Stack gap={4}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            <Stack gap={2} className="pt-4 border-t border-border">
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
          {controller.canViewBackups && (
            <Stack gap={2} className="pt-4 border-t border-border">
              <Text variant="h4">
                Archives ({controller.archivesLoading ? '…' : controller.archives.length})
              </Text>
              <ArchiveList controller={controller} />
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
