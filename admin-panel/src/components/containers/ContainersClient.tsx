'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Dialog } from '@/components/core/Dialog';
import {
  Box, RefreshCw, RotateCcw, CheckCircle2, AlertCircle,
  Layers, HelpCircle, Trash2, Terminal, X
} from 'lucide-react';
import Link from 'next/link';
import { controlContainer, runCompose, ContainerInfo } from '@/app/actions/docker';
import {
  updateContainerConfig,
  resetRestartCount,
  syncContainerConfigWithDocker,
  ContainerRestartConfig
} from '@/app/actions/containerConfig';
import {
  analyzeRestartRequirements,
  analyzeContainerDependencies,
} from '@/app/actions/services';
import { getDiscordWebhookStatus } from '@/lib/discord-notifier';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LogViewerModal } from '@/components/containers/LogViewerModal';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { StatsCard } from '@/components/containers/StatsCard';
import { StackActionButton } from '@/components/containers/StackActionButton';
import { SystemLogsPanel } from '@/components/containers/SystemLogsPanel';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { EmptyState } from '@/components/core/EmptyState';
import { SkeletonTable } from '@/components/core/Skeleton';
import { LiveIndicator } from '@/components/core/LiveIndicator';
import { useLiveStream } from '@/hooks/useLiveStream';
import type { ContainersFrame } from '@/lib/live-frames';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';

export function ContainersClient(): React.JSX.Element {
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
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
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

  const handleToggleSelection = useCallback((containerId: string): void => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  }, []);

  const handleClearSelection = (): void => {
    setSelectedIds(new Set());
  };

  const maybeShowDiscordGuard = useCallback((): void => {
    if (isDiscordConfigured === false && !hasShownDiscordToast) {
      toast.warning('Discord not configured', { description: 'Webhook is empty — notifications will be skipped until configured in settings.' });
      setHasShownDiscordToast(true);
    }
  }, [isDiscordConfigured, hasShownDiscordToast]);

  const handleOpenBulkRestart = async (): Promise<void> => {
    maybeShowDiscordGuard();
    const selectedNames = containers.filter((container) => selectedIds.has(container.id)).map((container) => container.name);
    try {
      // Why: analyzeRestartRequirements expands env triggers, container dependencies expands direct service graph; both give full impact preview
      const envResult = await analyzeRestartRequirements(selectedNames);
      const containerExpanded = await analyzeContainerDependencies(selectedNames);
      const combined = Array.from(new Set([...envResult.requiredRestarts, ...containerExpanded]));
      setRestartPreview(combined.length > 0 ? combined : selectedNames);
    } catch {
      setRestartPreview(selectedNames);
    }
    setShowBulkRestartDialog(true);
  };

  const handleConfirmBulkRestart = async (): Promise<void> => {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      const result = await controlContainer(id, 'restart');
      if (!result.success) {
        toast.error('Error', { description: result.error ?? 'Failed to restart container' });
      }
    }
    toast.success('Success', { description: `Restart triggered for ${ids.length} containers` });
    setBulkLoading(false);
    setShowBulkRestartDialog(false);
    handleClearSelection();
    refresh();
  };

  const handleConfirmBulkRemove = async (): Promise<void> => {
    maybeShowDiscordGuard();
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    for (const id of ids) {
      const result = await controlContainer(id, 'stop');
      if (!result.success) {
        toast.error('Error', { description: result.error ?? 'Failed to stop container' });
      }
    }
    toast.success('Success', { description: `Stop triggered for ${ids.length} containers` });
    setBulkLoading(false);
    setShowBulkRemoveDialog(false);
    handleClearSelection();
    refresh();
  };

  const handleConfirmBulkLogs = (): void => {
    const firstId = Array.from(selectedIds)[0];
    const first = containers.find((container) => container.id === firstId);
    if (first) setSelectedContainer({ id: first.id, name: first.name });
    setShowBulkLogsDialog(false);
  };

  const handleControl = async (id: string, action: 'start' | 'stop' | 'restart') => {
    maybeShowDiscordGuard();
    setActionLoading(id);
    const res = await controlContainer(id, action);
    if (res.success) {
      toast.success('Success', { description: `Container ${action}ed successfully` });
      refresh();
    } else {
      toast.error('Error', { description: res.error });
    }
    setActionLoading(null);
  };

  const handleCompose = async (
    action: 'up' | 'down' | 'restart' | 'build',
    serviceType?: 'core' | 'admin' | 'contest' | 'worker'
  ) => {
    maybeShowDiscordGuard();
    setActionLoading('compose');
    const res = await runCompose(action, serviceType);
    if (res.success) {
      toast.success('Success', { description: `Compose ${action} completed` });
      refresh();
    } else {
      toast.error('Error', { description: res.error });
    }
    setActionLoading(null);
  };

  const handleToggleAutoRestart = async (containerId: string, currentValue: boolean) => {
    const res = await updateContainerConfig(containerId, {
      autoRestart: !currentValue,
    });
    if (res.success) {
      toast.success('Success', { description: `Auto-restart ${!currentValue ? 'enabled' : 'disabled'}` });
      refresh();
    } else {
      toast.error('Error', { description: res.error });
    }
  };

  const handleResetRestartCount = async (containerId: string) => {
    const res = await resetRestartCount(containerId);
    if (res.success) {
      toast.success('Success', { description: 'Restart count reset' });
      refresh();
    } else {
      toast.error('Error', { description: res.error });
    }
  };

  const handleToggleDiscordNotifications = async (containerId: string, currentValue: boolean) => {
    const res = await updateContainerConfig(containerId, {
      discordNotifications: !currentValue,
    });
    if (res.success) {
      toast.success('Success', { description: `Discord notifications ${!currentValue ? 'enabled' : 'disabled'}` });
      refresh();
    } else {
      toast.error('Error', { description: res.error });
    }
  };

  const selectedCount = selectedIds.size;
  const selectedNames = containers.filter((container) => selectedIds.has(container.id)).map((container) => container.name);

  return (
    <div className="space-y-8">
      {selectedContainer && (
        <LogViewerModal
          containerId={selectedContainer.id}
          containerName={selectedContainer.name}
          onClose={() => setSelectedContainer(null)}
        />
      )}
      {settingsContainer && (
        <ContainerSettingsModal
          containerId={settingsContainer.id}
          containerName={settingsContainer.name}
          config={containerConfig[settingsContainer.id] || { autoRestart: false, maxRestarts: 5, currentRestarts: 0 }}
          onClose={() => setSettingsContainer(null)}
          onUpdate={refresh}
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Container Control Center</h1>
            <Link href={`/${locale}/docs#services`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title="View Documentation">
              <HelpCircle className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-muted-foreground mt-1">Manage and monitor Docker services in real-time.</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator status={status} />
          <Button
            onClick={() => handleCompose('up')}
            disabled={actionLoading === 'compose'}
          >
            <Layers className="w-4 h-4 mr-2" /> Up All
          </Button>
          <Button
            variant="secondary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-card border border-border rounded-xl shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground">{selectedCount} selected</span>
            {isDiscordConfigured === false && (
              <span className="px-2 py-1 bg-warning/10 border border-warning/20 text-warning text-xs font-bold rounded-full">Discord not configured</span>
            )}
            <button onClick={handleClearSelection} className="p-1 hover:bg-accent rounded-full text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="positiveOutline" size="sm" onClick={handleOpenBulkRestart} disabled={bulkLoading} tooltip="Restart selected containers">
              <motion.span animate={bulkLoading ? { rotate: 360 } : { rotate: 0 }} transition={bulkLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.2 }} className="flex">
                <RotateCcw className="w-4 h-4" />
              </motion.span>
              Restart
            </Button>
            <Button variant="negativeOutline" size="sm" onClick={() => { maybeShowDiscordGuard(); setShowBulkRemoveDialog(true); }} tooltip="Stop selected containers">
              <Trash2 className="w-4 h-4" />
              Remove
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShowBulkLogsDialog(true)} tooltip="View logs for selection">
              <Terminal className="w-4 h-4" />
              Logs
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Box} label="Total" value={containers.length} color="primary" />
        <StatsCard icon={CheckCircle2} label="Running" value={containers.filter(c => c.state === 'running').length} color="success" />
        <StatsCard icon={AlertCircle} label="Stopped" value={containers.filter(c => c.state !== 'running').length} color="destructive" />
        <StatsCard icon={RotateCcw} label="Uptime" value="99.9%" color="info" />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/50 flex items-center justify-between">
            <h2 className="font-bold text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Active Containers
            </h2>
        </div>
        <div className="divide-y divide-border">
          {containers.map((container) => (
            <ContainerRow
              key={container.id}
              container={container}
              config={containerConfig[container.id] || { autoRestart: false, maxRestarts: 5, currentRestarts: 0, discordNotifications: true }}
              restartCount={restartCounts[container.id] || 0}
              actionLoading={actionLoading}
              onViewLogs={setSelectedContainer}
              onOpenSettings={setSettingsContainer}
              onControl={handleControl}
              onToggleAutoRestart={handleToggleAutoRestart}
              onResetRestartCount={handleResetRestartCount}
              onToggleDiscordNotifications={handleToggleDiscordNotifications}
              isSelected={selectedIds.has(container.id)}
              onToggleSelection={handleToggleSelection}
            />
          ))}

          {containers.length === 0 && loading && (
            <div className="p-6">
              <SkeletonTable rows={4} cols={1} />
            </div>
          )}

          {containers.length === 0 && !loading && (
            <EmptyState
              icon={Box}
              title="No Docker containers found on this host."
              className="border-none"
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6 space-y-4">
              <h3 className="font-bold text-foreground">Stack Controls</h3>
              <p className="text-sm text-muted-foreground">Manage complete service groups via Docker Compose.</p>
              <div className="grid grid-cols-2 gap-3">
                  <StackActionButton label="All Services" onRestart={() => handleCompose('restart')} onUp={() => handleCompose('up')} onBuild={() => handleCompose('build')} isLoading={actionLoading === 'compose'} />
                  <StackActionButton label="Core Stack" onRestart={() => handleCompose('restart', 'core')} onUp={() => handleCompose('up', 'core')} onBuild={() => handleCompose('build', 'core')} isLoading={actionLoading === 'compose'} />
                  <StackActionButton label="Admin Stack" onRestart={() => handleCompose('restart', 'admin')} onUp={() => handleCompose('up', 'admin')} onBuild={() => handleCompose('build', 'admin')} isLoading={actionLoading === 'compose'} />
                  <StackActionButton label="Worker Stack" onRestart={() => handleCompose('restart', 'worker')} onUp={() => handleCompose('up', 'worker')} onBuild={() => handleCompose('build', 'worker')} isLoading={actionLoading === 'compose'} />
              </div>
          </Card>

          <SystemLogsPanel containers={containers} />
      </div>

      <Dialog
        open={showBulkRestartDialog}
        onOpenChange={(open) => { if (!open) setShowBulkRestartDialog(false); }}
        title="Confirm Restart"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => setShowBulkRestartDialog(false)}>Cancel</Button>
            <Button variant="positive" onClick={handleConfirmBulkRestart} loading={bulkLoading}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Confirm Restart
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will restart the selected containers and their dependents.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3">
            <div className="text-xs font-bold text-muted-foreground mb-1">This will restart:</div>
            <div className="text-sm font-mono text-foreground break-words">
              {restartPreview.length > 0 ? restartPreview.join(' -> ') : selectedNames.join(', ')}
            </div>
            {restartPreview.length > 1 && (
              <div className="text-xs text-muted-foreground mt-1">Includes dependent services via restart policies</div>
            )}
          </div>
          {isDiscordConfigured === false && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-2 text-xs text-warning">Discord not configured — notifications will be skipped</div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={showBulkRemoveDialog}
        onOpenChange={(open) => { if (!open) setShowBulkRemoveDialog(false); }}
        title="Confirm Stop"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => setShowBulkRemoveDialog(false)}>Cancel</Button>
            <Button variant="negative" onClick={handleConfirmBulkRemove} loading={bulkLoading}>
              <Trash2 className="w-4 h-4 mr-2" />
              Confirm Stop
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This will stop the selected containers. You can start them again from the control center.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm font-mono text-foreground break-words">
            {selectedNames.join(', ')}
          </div>
          {isDiscordConfigured === false && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-2 text-xs text-warning">Discord not configured — notifications will be skipped</div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={showBulkLogsDialog}
        onOpenChange={(open) => { if (!open) setShowBulkLogsDialog(false); }}
        title="View Logs"
        description={`${selectedCount} containers selected`}
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="ghost" onClick={() => setShowBulkLogsDialog(false)}>Cancel</Button>
            <Button variant="secondary" onClick={handleConfirmBulkLogs}>
              <Terminal className="w-4 h-4 mr-2" />
              View Logs
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Open logs for the first selected container. Use individual rows for more containers.</p>
          <div className="bg-muted/40 border border-border rounded-lg p-3 text-sm font-mono text-foreground break-words">
            {selectedNames.join(', ')}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
