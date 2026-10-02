'use client';

import { Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { SurfaceState } from '@/components/core/SurfaceState';
import { MaintenanceBackupsCard } from '@/components/system/MaintenanceBackupsCard';
import { MaintenanceNotificationsCard } from '@/components/system/MaintenanceNotificationsCard';
import { usePublishModuleTabActions } from '@/components/navigation/ModuleTabActionSlot';
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
  const { loading, saving, canConfigure, handleSave } = controller;

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
      <MaintenanceBackupsCard controller={controller} />
      <MaintenanceNotificationsCard controller={controller} />
    </div>
  );
}
