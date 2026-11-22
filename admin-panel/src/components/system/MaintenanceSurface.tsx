'use client';

import { createContext, useContext } from 'react';
import { Save } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { SurfaceLoadState } from '@/components/core/SurfaceLoadState';
import { useMaintenanceController } from '@/components/system/useMaintenanceController';
import { useDictionary } from '@/hooks/useDictionary';
import type { MaintenanceController } from '@/components/system/maintenance-types';
import type { Locale } from '@/lib/locales';

const MaintenanceContext = createContext<MaintenanceController | null>(null);

/**
 * The one controller the page's groups share.
 *
 * WHY a provider and not a prop per card: the backup policy, the notification wiring and the archive
 * list are one screen's state, and the settings layout renders each group as its own slot - so the
 * controller has to sit above them rather than be threaded through the layout, which knows nothing
 * about it. A second controller would be a second read and a second save.
 */
export function useMaintenance(): MaintenanceController {
  const controller = useContext(MaintenanceContext);
  if (controller === null) {
    throw new Error('useMaintenance must be used inside MaintenanceProvider');
  }
  return controller;
}

export function MaintenanceProvider({
  locale,
  permissionKeys,
  children,
}: {
  readonly locale: Locale;
  readonly permissionKeys: readonly string[];
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const controller = useMaintenanceController(locale, permissionKeys);
  const dict = useDictionary();
  // Why the load replaces the groups rather than each group loading itself: the settings the groups
  // edit have not been read yet, so a group drawn now would show empty fields as if they were the
  // stored values.
  if (controller.status.kind !== 'idle') {
    return (
      <SurfaceLoadState
        status={controller.status}
        loadingTitle={dict.navigation.system.maintenance.label}
        onRetry={controller.reload}
        retryLabel={dict.states.retry.label}
      />
    );
  }
  return <MaintenanceContext.Provider value={controller}>{children}</MaintenanceContext.Provider>;
}

/**
 * The page's save: it writes the backup policy, which is the only setting on the page that waits for
 * a press. The notification group saves itself, beside the webhook it writes.
 */
export function MaintenanceSaveBar(): React.JSX.Element {
  const { saving, canConfigure, handleSave } = useMaintenance();
  return (
    <Button variant="positive" onClick={() => void handleSave()} loading={saving} disabled={!canConfigure}>
      <Save className="h-4 w-4" />
      {saving ? 'Saving...' : 'Save Settings'}
    </Button>
  );
}
