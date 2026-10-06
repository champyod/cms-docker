'use client';
import { Box, RefreshCw, RotateCcw, CheckCircle2, AlertCircle, Layers, HelpCircle, Trash2, ScrollText, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';

import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { SkeletonTable } from '@/components/core/Skeleton';
import { LiveIndicator } from '@/components/core/LiveIndicator';
import { BulkDialogs } from '@/components/containers/BulkDialogs';
import { LogViewerModal } from '@/components/containers/LogViewerModal';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { StatsCard } from '@/components/containers/StatsCard';
import { ContainerStackControls } from '@/components/containers/ContainerStackControls';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { useContainersController } from '@/components/containers/useContainersController';
import { usePublishModuleTabActions } from '@/components/navigation/ModuleTabActionSlot';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { buildRoute } from '@/lib/navigation/routes';
import { cn } from '@/lib/utils';

const DEFAULT_RESTART_CONFIG = { autoRestart: false, maxRestarts: 5, currentRestarts: 0 } as const;
const DEFAULT_ROW_CONFIG = { ...DEFAULT_RESTART_CONFIG, discordNotifications: true };

export function ContainersClient(): React.JSX.Element {
  const dict = useDictionary();
  const pageCopy = dict.containers;
  const controller = useContainersController();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const docsPath = buildRoute(locale, 'system.docs');

  const selectedCount = controller.selectedIds.size;
  const selectedNames = controller.containers
    .filter((container) => controller.selectedIds.has(container.id))
    .map((container) => container.name);

  // Why one controller serves both places: these controls read the compose action, the stream
  // status, and the refresh the controller just ran, so they are published from the panel that
  // owns it rather than rebuilt from a second instance in the header.
  usePublishModuleTabActions(
    'infrastructure.containers',
    <div className="flex items-center gap-3">
      <LiveIndicator status={controller.status} />
      <Button onClick={() => void controller.handleCompose('up')} disabled={controller.actionLoading === 'compose'}>
        <Layers className="w-4 h-4 mr-2" /> {pageCopy.upAll}
      </Button>
      <Button variant="secondary" onClick={controller.refresh} disabled={controller.loading}>
        <RefreshCw className={cn('w-4 h-4', controller.loading && 'animate-spin')} />
      </Button>
      <Link
        href={`${docsPath}#services`}
        className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground"
        title={dict.docs.viewDocumentation}
      >
        <HelpCircle className="w-5 h-5" />
      </Link>
    </div>,
  );

  return (
    <div className="space-y-8">
        {controller.selectedContainer && (
          <LogViewerModal
            containerId={controller.selectedContainer.id}
            containerName={controller.selectedContainer.name}
            onClose={() => controller.setSelectedContainer(null)}
          />
        )}
        {controller.settingsContainer && (
          <ContainerSettingsModal
            containerId={controller.settingsContainer.id}
            containerName={controller.settingsContainer.name}
            config={controller.containerConfig[controller.settingsContainer.id] ?? DEFAULT_RESTART_CONFIG}
            onClose={() => controller.setSettingsContainer(null)}
            onUpdate={controller.refresh}
          />
        )}

        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-card border border-border rounded-xl shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">
                {interpolate(pageCopy.selected, { count: selectedCount })}
              </span>
              {controller.isDiscordConfigured === false && (
                <span className="px-2 py-1 bg-warning/10 border border-warning/20 text-warning text-xs font-bold rounded-full">
                  {pageCopy.discordBadge}
                </span>
              )}
              <Button variant="ghost" iconOnly icon={X} tooltip={pageCopy.clearSelection} aria-label={pageCopy.clearSelection} onClick={controller.handleClearSelection} className="rounded-full" />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="positiveOutline" size="sm" onClick={() => void controller.handleOpenBulkRestart()} disabled={controller.bulkLoading} tooltip={pageCopy.restartSelection}>
                <motion.span
                  animate={controller.bulkLoading ? { rotate: 360 } : { rotate: 0 }}
                  transition={controller.bulkLoading ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.2 }}
                  className="flex"
                >
                  <RotateCcw className="w-4 h-4" />
                </motion.span>
                {pageCopy.restart}
              </Button>
              <Button variant="negativeOutline" size="sm" onClick={controller.handleOpenBulkRemove} tooltip={pageCopy.stopSelection}>
                <Trash2 className="w-4 h-4" />
                {pageCopy.remove}
              </Button>
              <Button variant="secondary" size="sm" onClick={controller.handleOpenBulkLogs} tooltip={pageCopy.logsSelection}>
                <ScrollText className="w-4 h-4" />
                {pageCopy.logs}
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard icon={Box} label={pageCopy.stats.total} value={controller.containers.length} color="primary" />
          <StatsCard icon={CheckCircle2} label={pageCopy.stats.running} value={controller.containers.filter((c) => c.state === 'running').length} color="success" />
          <StatsCard icon={AlertCircle} label={pageCopy.stats.stopped} value={controller.containers.filter((c) => c.state !== 'running').length} color="destructive" />
          <StatsCard icon={RotateCcw} label={pageCopy.stats.uptime} value="99.9%" color="info" />
        </div>

        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/50 flex items-center justify-between">
            <h2 className="font-bold text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              {pageCopy.activeContainers}
            </h2>
          </div>
          <div className="divide-y divide-border">
            {controller.containers.map((container) => (
              <ContainerRow
                key={container.id}
                container={container}
                config={controller.containerConfig[container.id] ?? DEFAULT_ROW_CONFIG}
                restartCount={controller.restartCounts[container.id] ?? 0}
                actionLoading={controller.actionLoading}
                onViewLogs={controller.setSelectedContainer}
                onOpenSettings={controller.setSettingsContainer}
                onControl={controller.handleControl}
                onToggleAutoRestart={controller.handleToggleAutoRestart}
                onResetRestartCount={controller.handleResetRestartCount}
                onToggleDiscordNotifications={controller.handleToggleDiscordNotifications}
                isSelected={controller.selectedIds.has(container.id)}
                // Why protected rows cannot be selected: bulk stop/restart is aimed at the selection,
                // and the security boundary must not be reachable through a bulk action at all.
                onToggleSelection={container.protected ? undefined : controller.handleToggleSelection}
              />
            ))}

            {controller.containers.length === 0 && controller.loading && (
              <div className="p-6">
                <SkeletonTable rows={4} cols={1} />
              </div>
            )}

            {controller.containers.length === 0 && !controller.loading && (
              <EmptyState icon={Box} title={pageCopy.emptyTitle} className="border-none" />
            )}
          </div>
        </Card>

        <ContainerStackControls
          containers={controller.containers}
          actionLoading={controller.actionLoading}
          onCompose={controller.handleCompose}
        />

        <BulkDialogs
          copy={pageCopy.bulk}
          selectedCount={selectedCount}
          selectedNames={selectedNames}
          restartPreview={controller.restartPreview}
          isDiscordConfigured={controller.isDiscordConfigured}
          bulkLoading={controller.bulkLoading}
          showRestart={controller.showBulkRestartDialog}
          showRemove={controller.showBulkRemoveDialog}
          showLogs={controller.showBulkLogsDialog}
          setShowRestart={controller.setShowBulkRestartDialog}
          setShowRemove={controller.setShowBulkRemoveDialog}
          setShowLogs={controller.setShowBulkLogsDialog}
          onConfirmRestart={() => void controller.handleConfirmBulkRestart()}
          onConfirmRemove={() => void controller.handleConfirmBulkRemove()}
          onConfirmLogs={controller.handleConfirmBulkLogs}
        />
      </div>
  );
}
