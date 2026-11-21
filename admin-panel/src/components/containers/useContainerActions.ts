'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

import { controlContainer, runCompose } from '@/app/actions/docker';
import {
  resetRestartCount,
  updateContainerConfig,
} from '@/app/actions/containerConfig';
import {
  analyzeContainerDependencies,
  analyzeRestartRequirements,
} from '@/app/actions/services';
import { interpolate } from '@/lib/interpolate';
import { useDictionary } from '@/hooks/useDictionary';
import type { ContainerInfo } from '@/app/actions/docker';
import type { Dispatch, SetStateAction } from 'react';

export interface ContainerActionContext {
  readonly containers: ContainerInfo[];
  readonly selectedIds: ReadonlySet<string>;
  readonly refresh: () => void;
  readonly notifyDiscordGuard: () => void;
  readonly clearSelection: () => void;
  readonly setActionLoading: Dispatch<SetStateAction<string | null>>;
  readonly setBulkLoading: Dispatch<SetStateAction<boolean>>;
  readonly setRestartPreview: Dispatch<SetStateAction<string[]>>;
  readonly setShowBulkRestartDialog: Dispatch<SetStateAction<boolean>>;
  readonly setShowBulkRemoveDialog: Dispatch<SetStateAction<boolean>>;
  readonly setShowBulkLogsDialog: Dispatch<SetStateAction<boolean>>;
  readonly setSelectedContainer: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
}

export interface ContainerActions {
  readonly handleControl: (id: string, action: 'start' | 'stop' | 'restart') => Promise<void>;
  readonly handleCompose: (
    action: 'up' | 'down' | 'restart' | 'build',
    serviceType?: 'core' | 'admin' | 'contest' | 'worker',
  ) => Promise<void>;
  readonly handleToggleAutoRestart: (containerId: string, currentValue: boolean) => Promise<void>;
  readonly handleResetRestartCount: (containerId: string) => Promise<void>;
  readonly handleToggleDiscordNotifications: (containerId: string, currentValue: boolean) => Promise<void>;
  readonly handleOpenBulkRestart: () => Promise<void>;
  readonly handleOpenBulkRemove: () => void;
  readonly handleOpenBulkLogs: () => void;
  readonly handleConfirmBulkRestart: () => Promise<void>;
  readonly handleConfirmBulkRemove: () => Promise<void>;
  readonly handleConfirmBulkLogs: () => void;
}

function selectedNames(containers: ContainerInfo[], selectedIds: ReadonlySet<string>): string[] {
  return containers.filter((container) => selectedIds.has(container.id)).map((container) => container.name);
}

export function useContainerActions(context: ContainerActionContext): ContainerActions {
  const toastCopy = useDictionary().toasts.containers;
  const {
    containers, selectedIds, refresh, notifyDiscordGuard, clearSelection,
    setActionLoading, setBulkLoading, setRestartPreview,
    setShowBulkRestartDialog, setShowBulkRemoveDialog, setShowBulkLogsDialog,
    setSelectedContainer,
  } = context;

  // Why one reporter: every mutation below either announces its own success and
  // reopens the stream, or reports why it failed — never both, and never silently.
  const reportResult = useCallback((result: { success: boolean; error?: string }, successTitle: string): void => {
    if (result.success) {
      toast.success(successTitle);
      refresh();
    } else {
      toast.error(toastCopy.errorTitle, { description: result.error ?? toastCopy.errorTitle });
    }
  }, [refresh, toastCopy]);

  const handleControl = useCallback(async (id: string, action: 'start' | 'stop' | 'restart'): Promise<void> => {
    notifyDiscordGuard();
    setActionLoading(id);
    const res = await controlContainer(id, action);
    reportResult(res, interpolate(toastCopy.controlSucceeded, { action }));
    setActionLoading(null);
  }, [notifyDiscordGuard, setActionLoading, reportResult, toastCopy]);

  const handleCompose = useCallback(async (
    action: 'up' | 'down' | 'restart' | 'build',
    serviceType?: 'core' | 'admin' | 'contest' | 'worker',
  ): Promise<void> => {
    notifyDiscordGuard();
    setActionLoading('compose');
    const res = await runCompose(action, serviceType);
    reportResult(res, interpolate(toastCopy.composeSucceeded, { action }));
    setActionLoading(null);
  }, [notifyDiscordGuard, setActionLoading, reportResult, toastCopy]);

  const handleToggleAutoRestart = useCallback(async (containerId: string, currentValue: boolean): Promise<void> => {
    const res = await updateContainerConfig(containerId, { autoRestart: !currentValue });
    reportResult(res, !currentValue ? toastCopy.autoRestartEnabled : toastCopy.autoRestartDisabled);
  }, [reportResult, toastCopy]);

  const handleResetRestartCount = useCallback(async (containerId: string): Promise<void> => {
    const res = await resetRestartCount(containerId);
    reportResult(res, toastCopy.restartCountReset);
  }, [reportResult, toastCopy]);

  const handleToggleDiscordNotifications = useCallback(async (containerId: string, currentValue: boolean): Promise<void> => {
    const res = await updateContainerConfig(containerId, { discordNotifications: !currentValue });
    reportResult(res, !currentValue ? toastCopy.discordEnabled : toastCopy.discordDisabled);
  }, [reportResult, toastCopy]);

  const handleOpenBulkRestart = useCallback(async (): Promise<void> => {
    notifyDiscordGuard();
    const names = selectedNames(containers, selectedIds);
    try {
      // Why: analyzeRestartRequirements expands env triggers, container dependencies expands direct service graph; both give full impact preview
      const envResult = await analyzeRestartRequirements(names);
      const containerExpanded = await analyzeContainerDependencies(names);
      const combined = Array.from(new Set([...envResult.requiredRestarts, ...containerExpanded]));
      setRestartPreview(combined.length > 0 ? combined : names);
    } catch {
      setRestartPreview(names);
    }
    setShowBulkRestartDialog(true);
  }, [notifyDiscordGuard, containers, selectedIds, setRestartPreview, setShowBulkRestartDialog]);

  const handleOpenBulkRemove = useCallback((): void => {
    notifyDiscordGuard();
    setShowBulkRemoveDialog(true);
  }, [notifyDiscordGuard, setShowBulkRemoveDialog]);

  const handleOpenBulkLogs = useCallback((): void => {
    setShowBulkLogsDialog(true);
  }, [setShowBulkLogsDialog]);

  const bulkControl = useCallback(async (action: 'restart' | 'stop'): Promise<void> => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      const result = await controlContainer(id, action);
      if (!result.success) {
        toast.error(toastCopy.errorTitle, {
          description: result.error ?? (action === 'restart' ? toastCopy.restartFailedFallback : toastCopy.stopFailedFallback),
        });
      }
    }    toast.success(interpolate(action === 'restart' ? toastCopy.restartTriggered : toastCopy.stopTriggered, { count: ids.length }));
    setBulkLoading(false);
    setShowBulkRestartDialog(false);
    setShowBulkRemoveDialog(false);
    clearSelection();
    refresh();
  }, [selectedIds, toastCopy, setBulkLoading, setShowBulkRestartDialog, setShowBulkRemoveDialog, clearSelection, refresh]);

  const handleConfirmBulkRestart = useCallback((): Promise<void> => bulkControl('restart'), [bulkControl]);
  const handleConfirmBulkRemove = useCallback((): Promise<void> => bulkControl('stop'), [bulkControl]);

  const handleConfirmBulkLogs = useCallback((): void => {
    const first = containers.find((container) => container.id === Array.from(selectedIds)[0]);
    if (first) setSelectedContainer({ id: first.id, name: first.name });
    setShowBulkLogsDialog(false);
  }, [containers, selectedIds, setSelectedContainer, setShowBulkLogsDialog]);

  return {
    handleControl,
    handleCompose,
    handleToggleAutoRestart,
    handleResetRestartCount,
    handleToggleDiscordNotifications,
    handleOpenBulkRestart,
    handleOpenBulkRemove,
    handleOpenBulkLogs,
    handleConfirmBulkRestart,
    handleConfirmBulkRemove,
    handleConfirmBulkLogs,
  };
}
