'use client';

import { useCallback, useState } from 'react';

import { useActionFeedback } from '@/hooks/useActionFeedback';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import type { SurfaceStatus } from '@/components/core/SurfaceState';
import {
  surfaceLoadMessages,
  useSurfaceLoad,
  type SurfaceLoadMessages,
} from '@/hooks/useSurfaceLoad';
import type { Locale } from '@/lib/locales';
import { hasEffectivePermission } from '@/lib/permission-engine';

import {
  loadMaintenanceData,
  readArchives,
  runManualBackup,
  saveConfiguration,
  persistNotifications,
  sendTestAlert,
  type MaintenanceActionConfig,
} from '@/components/system/maintenance-actions';
import {
  INITIAL_MAINTENANCE_STATE,
  type MaintenanceController,
  type MaintenanceGates,
  type MaintenanceState,
  type MaintenanceToasts,
  type Patch,
} from '@/components/system/maintenance-types';

type MaintenanceHandlers = Pick<
  MaintenanceController,
  | 'handleChange'
  | 'handleSave'
  | 'handleBackup'
  | 'persistDiscordSettings'
  | 'handleTestAlert'
  | 'loadArchives'
>;

function permissionGates(permissionKeys: readonly string[]): MaintenanceGates {
  // Strict own key, mirroring triggerManualBackup; this only hides.
  const effective = new Set(permissionKeys);
  return {
    canTriggerBackup: hasEffectivePermission(effective, 'backup:create'),
    canConfigure: hasEffectivePermission(effective, 'maintenance:update'),
    canViewBackups: hasEffectivePermission(effective, 'backup:list'),
    canTestAlert: hasEffectivePermission(effective, 'monitor:test'),
  };
}

interface MaintenanceLoad {
  readonly state: MaintenanceState;
  readonly patch: Patch;
  readonly status: SurfaceStatus;
  readonly reload: () => void;
}

function useMaintenanceState(
  gates: MaintenanceGates,
  messages: SurfaceLoadMessages,
): MaintenanceLoad {
  const [state, setState] = useState<MaintenanceState>(INITIAL_MAINTENANCE_STATE);
  const load = useCallback(
    () => loadMaintenanceData(gates.canConfigure, gates.canViewBackups, setState),
    [gates.canConfigure, gates.canViewBackups],
  );
  const { status, reload } = useSurfaceLoad(load, messages);
  return { state, patch: setState, status, reload };
}

function useMaintenanceHandlers(
  actions: MaintenanceActionConfig,
): MaintenanceHandlers {
  const { patch, gates } = actions;
  const handleChange = useCallback((key: string, value: string) => {
    patch((previous) => ({ ...previous, data: { ...previous.data, [key]: value } }));
  }, [patch]);
  const handleSave = useCallback(async () => { await saveConfiguration(actions); }, [actions]);
  const persistDiscordSettings = useCallback(
    async (applyToMonitor: boolean) => { await persistNotifications(actions, applyToMonitor); },
    [actions],
  );
  const handleTestAlert = useCallback(async () => { await sendTestAlert(actions); }, [actions]);
  const loadArchives = useCallback(async () => {
    if (!gates.canViewBackups) return;
    await readArchives(patch);
  }, [gates.canViewBackups, patch]);
  const handleBackup = useCallback(
    async () => { await runManualBackup(actions, loadArchives); },
    [actions, loadArchives],
  );
  return { handleChange, handleSave, handleBackup, persistDiscordSettings, handleTestAlert, loadArchives };
}

export function useMaintenanceController(
  locale: Locale,
  permissionKeys: readonly string[],
): MaintenanceController {
  const dict = useDictionary();
  const toasts: MaintenanceToasts = dict.toasts.maintenance;
  const confirm = useConfirm();
  const { manualBackupConfirm } = useConfirmationCopy();
  const runAction = useActionFeedback();
  const gates = permissionGates(permissionKeys);
  const { state, patch, status, reload } = useMaintenanceState(gates, surfaceLoadMessages(dict));
  const handlers = useMaintenanceHandlers({
    locale, toasts, state, patch, gates, confirm, manualBackupConfirm, runAction,
  });
  return { locale, ...state, ...gates, ...handlers, status, reload };
}
