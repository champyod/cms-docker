'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { syncContainerConfigWithDocker } from '@/app/actions/containerConfig';
import { getDiscordWebhookStatus } from '@/lib/discord-notifier';
import { useLiveStream } from '@/hooks/useLiveStream';
import { useDictionary } from '@/hooks/useDictionary';
import { useContainerActions } from '@/components/containers/useContainerActions';
import type { ContainerRestartConfig } from '@/app/actions/containerConfig';
import type { ContainerInfo } from '@/app/actions/docker';
import type { LiveStatus, LiveStream } from '@/hooks/useLiveStream';
import type { ContainersFrame } from '@/lib/live-frames';
import type { Dispatch, SetStateAction } from 'react';

export interface ContainersController {
  readonly containers: ContainerInfo[];
  readonly loading: boolean;
  readonly actionLoading: string | null;
  readonly containerConfig: ContainerRestartConfig;
  readonly restartCounts: Readonly<Record<string, number>>;
  readonly selectedIds: ReadonlySet<string>;
  readonly isDiscordConfigured: boolean | null;
  readonly restartPreview: string[];
  readonly bulkLoading: boolean;
  readonly showBulkRestartDialog: boolean;
  readonly showBulkRemoveDialog: boolean;
  readonly showBulkLogsDialog: boolean;
  readonly selectedContainer: { readonly id: string; readonly name: string } | null;
  readonly settingsContainer: { readonly id: string; readonly name: string } | null;
  readonly status: LiveStatus;
  readonly refresh: LiveStream['refresh'];
  readonly setSelectedContainer: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  readonly setSettingsContainer: Dispatch<SetStateAction<{ id: string; name: string } | null>>;
  readonly setShowBulkRestartDialog: Dispatch<SetStateAction<boolean>>;
  readonly setShowBulkRemoveDialog: Dispatch<SetStateAction<boolean>>;
  readonly setShowBulkLogsDialog: Dispatch<SetStateAction<boolean>>;
  readonly handleToggleSelection: (containerId: string) => void;
  readonly handleClearSelection: () => void;
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

export function useContainersController(): ContainersController {
  const toastCopy = useDictionary().toasts.containers;
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string, name: string } | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<{ id: string, name: string } | null>(null);
  const [containerConfig, setContainerConfig] = useState<ContainerRestartConfig>({});
  const [restartCounts, setRestartCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDiscordConfigured, setIsDiscordConfigured] = useState<boolean | null>(null);
  const [hasShownDiscordToast, setHasShownDiscordToast] = useState(false);
  const [showBulkRestartDialog, setShowBulkRestartDialog] = useState(false);
  const [showBulkRemoveDialog, setShowBulkRemoveDialog] = useState(false);
  const [showBulkLogsDialog, setShowBulkLogsDialog] = useState(false);
  const [restartPreview, setRestartPreview] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const syncedConfigIdsRef = useRef<Set<string>>(new Set());

  // Every field arrives on one connection, so the table, its restart counts and its config are
  // replaced together — and a section that is missing (not readable, or its probe failed) leaves the
  // panel showing what it already had instead of an empty table.
  const onFrame = useCallback((frame: ContainersFrame): void => {
    if (frame.containers) setContainers(frame.containers);
    if (frame.config) setContainerConfig(frame.config);
    if (frame.restartCounts) setRestartCounts(frame.restartCounts);
    setLoading(false);
  }, []);

  const { status, refresh } = useLiveStream<ContainersFrame>({ url: '/api/containers/stream', onFrame });

  // Why this is a one-shot per container and not part of a poll: the page used to fire this write on
  // every tick for any cms container without a config entry. The snapshot shows which containers
  // still lack one, so syncing each of them once — and reopening the stream to pick up the result —
  // costs a request only when a container is genuinely new.
  useEffect(() => {
    for (const container of containers) {
      if (!container.isCmsContainer || containerConfig[container.id]) continue;
      if (syncedConfigIdsRef.current.has(container.id)) continue;
      syncedConfigIdsRef.current.add(container.id);
      void syncContainerConfigWithDocker(container.id).then((result) => {
        if (result.success) refresh();
      });
    }
  }, [containers, containerConfig, refresh]);

  const checkDiscordStatus = useCallback(async (): Promise<void> => {
    try {
      const status = await getDiscordWebhookStatus();
      setIsDiscordConfigured(status.configured);
    } catch {
      setIsDiscordConfigured(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void checkDiscordStatus());
  }, [checkDiscordStatus]);

  // Why warn once, not per action: an unconfigured webhook only means notifications are
  // skipped, and repeating it on every control press trains the operator to dismiss it.
  const maybeShowDiscordGuard = useCallback((): void => {
    if (isDiscordConfigured === false && !hasShownDiscordToast) {
      toast.warning(toastCopy.discordNotConfiguredTitle, { description: toastCopy.discordNotConfiguredDescription });
      setHasShownDiscordToast(true);
    }
  }, [isDiscordConfigured, hasShownDiscordToast, toastCopy]);

  const handleToggleSelection = useCallback((containerId: string): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  }, []);

  const handleClearSelection = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const actions = useContainerActions({
    containers,
    selectedIds,
    refresh,
    notifyDiscordGuard: maybeShowDiscordGuard,
    clearSelection: handleClearSelection,
    setActionLoading,
    setBulkLoading,
    setRestartPreview,
    setShowBulkRestartDialog,
    setShowBulkRemoveDialog,
    setShowBulkLogsDialog,
    setSelectedContainer,
  });

  return {
    containers,
    loading,
    actionLoading,
    containerConfig,
    restartCounts,
    selectedIds,
    isDiscordConfigured,
    restartPreview,
    bulkLoading,
    showBulkRestartDialog,
    showBulkRemoveDialog,
    showBulkLogsDialog,
    selectedContainer,
    settingsContainer,
    status,
    refresh,
    setSelectedContainer,
    setSettingsContainer,
    setShowBulkRestartDialog,
    setShowBulkRemoveDialog,
    setShowBulkLogsDialog,
    handleToggleSelection,
    handleClearSelection,
    ...actions,
  };
}
