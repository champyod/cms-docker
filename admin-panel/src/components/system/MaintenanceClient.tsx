'use client';

import { useState } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { SurfaceState } from '@/components/core/SurfaceState';
import { MaintenanceBackupsCard } from '@/components/system/MaintenanceBackupsCard';
import { MaintenanceNotificationsCard } from '@/components/system/MaintenanceNotificationsCard';
import { usePublishModuleTabActions } from '@/components/navigation/ModuleTabActionSlot';
import { useMaintenanceController } from '@/components/system/useMaintenanceController';
import { ArchiveBrowserSection } from '@/components/maintenance/ArchiveBrowserSection';
import { BackupSelectionSection } from '@/components/maintenance/BackupSelectionSection';
import { RestoreSection } from '@/components/maintenance/RestoreSection';
import { ScheduleRunsSection } from '@/components/maintenance/ScheduleRunsSection';
import { ScheduleSection } from '@/components/maintenance/ScheduleSection';
import { useDictionary } from '@/hooks/useDictionary';
import type { Locale } from '@/lib/locales';

export interface MaintenanceClientProps {
  readonly locale: Locale;
  readonly permissionKeys: readonly string[];
}

export function MaintenanceClient({
  locale,
  permissionKeys,
}: MaintenanceClientProps): React.JSX.Element {
  const dict = useDictionary();
  const controller = useMaintenanceController(locale, permissionKeys);
  const { loading, saving, canConfigure, handleSave } = controller;
  // A selective dump is launched detached, so the archive browser is told to look again rather
  // than showing the pre-run list until the operator presses Refresh.
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);

  // Why published from here and withdrawn while loading: the pending state the Save labels
  // itself with belongs to this controller, and the loading surface below replaces the panel
  // body before those settings have been read at all.
  usePublishModuleTabActions(
    'system.maintenance',
    canConfigure && !loading ? (
      <Button variant="positive" onClick={() => void handleSave()} loading={saving}>
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : 'Save Settings'}
      </Button>
    ) : null,
  );

  if (loading) {
    return <SurfaceState status={{ kind: 'loading', title: dict['navigation']['system']['maintenance']['label'] }} />;
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* The advanced backup operations belong under the backup policy they extend, so they
          stack in this column. The policy card keeps its own archive list: it is the only
          archive view gated on `backup:list`, and the sections below reach their own
          `backup:*` actions. */}
      <Stack gap={6}>
        <MaintenanceBackupsCard controller={controller} />
        <BackupSelectionSection onBackupComplete={() => setArchiveRefreshToken((token) => token + 1)} />
        <ArchiveBrowserSection refreshToken={archiveRefreshToken} />
        <ScheduleSection />
        <ScheduleRunsSection />
        <RestoreSection />
      </Stack>
      <MaintenanceNotificationsCard controller={controller} />
    </div>
  );
}
