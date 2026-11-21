'use client';

import { Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { MaintenanceBackupsCard } from '@/components/system/MaintenanceBackupsCard';
import { MaintenanceNotificationsCard } from '@/components/system/MaintenanceNotificationsCard';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useMaintenanceController } from '@/components/system/useMaintenanceController';
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
  const { status, reload, saving, canConfigure, handleSave } = controller;

  // Why published from here and withdrawn unless loaded: the pending state the Save labels
  // itself with belongs to this controller, and the loading surface below replaces the panel
  // body before those settings have been read at all.
  usePublishModuleActions(
    'system.maintenance',
    canConfigure && status.kind === 'idle' ? (
      <Button variant="positive" onClick={() => void handleSave()} loading={saving}>
        <Save className="h-4 w-4" />
        {saving ? 'Saving...' : 'Save Settings'}
      </Button>
    ) : null,
  );

  if (status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={status}
        loadingTitle={dict['navigation']['system']['maintenance']['label']}
        onRetry={reload}
        retryLabel={dict.states.retry.label}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      {/* Backup operations moved to Backup & Restore; this page keeps the policy
          knobs those operations run under, and the notifications card. */}
      <Stack gap={6}>
        <MaintenanceBackupsCard controller={controller} />
      </Stack>
      <MaintenanceNotificationsCard controller={controller} />
    </div>
  );
}
