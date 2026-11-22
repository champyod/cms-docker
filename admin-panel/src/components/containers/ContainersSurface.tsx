'use client';

import { createContext, useContext } from 'react';
import { Box, RefreshCw, RotateCcw, CheckCircle2, AlertCircle, Layers, HelpCircle, Trash2, ScrollText, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Badge } from '@/components/core/Badge';
import { Button } from '@/components/core/Button';
import { EmptyState } from '@/components/core/EmptyState';
import { RowFreshness } from '@/components/core/RowFreshness';
import { SkeletonTable } from '@/components/core/Skeleton';
import { BulkDialogs } from '@/components/containers/BulkDialogs';
import { LogViewerModal } from '@/components/containers/LogViewerModal';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { StatsCard, StatsCardSkeleton } from '@/components/containers/StatsCard';
import { ContainerStackControls } from '@/components/containers/ContainerStackControls';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { useContainersController, type ContainersController } from '@/components/containers/useContainersController';
import { usePublishModuleActions } from '@/components/navigation/ModuleActionSlot';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { buildRoute } from '@/lib/navigation/routes';
import { cn } from '@/lib/utils';

const DEFAULT_RESTART_CONFIG = { autoRestart: false, maxRestarts: 5, currentRestarts: 0 } as const;
const DEFAULT_ROW_CONFIG = { ...DEFAULT_RESTART_CONFIG, discordNotifications: true };
/** The number of slots the stat grid has; its placeholders are laid out from the same count. */
const STAT_CARD_SLOT_COUNT = 4;

const ContainersContext = createContext<ContainersController | null>(null);

function useContainers(): ContainersController {
  const controller = useContext(ContainersContext);
  if (controller === null) {
    throw new Error('useContainers must be used inside ContainersProvider');
  }
  return controller;
}

/**
 * The one controller the three slots of the list share.
 *
 * WHY a provider: the counts, the rows and the stack controls read one stream and act on one
 * selection, and the list layout renders each of them in a slot of its own - so the controller has to
 * sit above the layout instead of being threaded through it. Two controllers would be two
 * connections and two selections that disagree about what is checked.
 */
export function ContainersProvider({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  const dict = useDictionary();
  const controller = useContainersController();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const pageCopy = dict.containers;
  const docsPath = buildRoute(locale, 'system.docs');

  // Why one controller serves both places: these controls read the compose action and the refresh
  // the controller just ran, so they are published from the panel that owns it rather than rebuilt
  // from a second instance in the header.
  usePublishModuleActions(
    'infrastructure.containers',
    <div className="flex items-center gap-3">
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
    <ContainersContext.Provider value={controller}>
      {children}
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
      <BulkDialogs
        copy={pageCopy.bulk}
        selectedCount={controller.selectedIds.size}
        selectedNames={controller.containers.filter((container) => controller.selectedIds.has(container.id)).map((container) => container.name)}
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
    </ContainersContext.Provider>
  );
}

/**
 * How much is there, and in what state.
 *
 * WHY this is the list's toolbar and not four cards above it: the counts describe the rows below
 * them - how many exist, how many run, how many do not - so they belong to the row set rather than to
 * a header of their own.
 */
export function ContainerStats(): React.JSX.Element {
  const { containers, loading } = useContainers();
  const pageCopy = useDictionary().containers;
  return (
    <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Why placeholders and not zeros: no frame has arrived, so there is no count to state. */}
      {loading ? (
        Array.from({ length: STAT_CARD_SLOT_COUNT }, (_, index) => <StatsCardSkeleton key={index} />)
      ) : (
        <>
          <StatsCard icon={Box} label={pageCopy.stats.total} value={containers.length} color="primary" />
          <StatsCard icon={CheckCircle2} label={pageCopy.stats.running} value={containers.filter((c) => c.state === 'running').length} color="success" />
          <StatsCard icon={AlertCircle} label={pageCopy.stats.stopped} value={containers.filter((c) => c.state !== 'running').length} color="destructive" />
          <StatsCard icon={RotateCcw} label={pageCopy.stats.uptime} value="99.9%" color="info" />
        </>
      )}
    </div>
  );
}

/**
 * The containers, and what can be done to one or to several.
 *
 * WHY the selection bar is here and not in the header: the bulk actions act on the checked rows, so
 * they belong to the row set the reader is checking - and the list layout has no slot of its own for
 * them.
 */
export function ContainerRows(): React.JSX.Element {
  const controller = useContainers();
  const pageCopy = useDictionary().containers;
  const selectedCount = controller.selectedIds.size;
  return (
    <div>
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground">
              {interpolate(pageCopy.selected, { count: selectedCount })}
            </span>
            {controller.isDiscordConfigured === false && (
              <Badge variant="warning">{pageCopy.discordBadge}</Badge>
            )}
            <Button variant="ghost" iconOnly icon={X} tooltip={pageCopy.clearSelection} aria-label={pageCopy.clearSelection} onClick={controller.handleClearSelection} className="rounded-full" />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="positiveOutline" size="sm" onClick={() => void controller.handleOpenBulkRestart()} disabled={controller.bulkLoading} tooltip={pageCopy.restartSelection}>
              <RotateCcw className="w-4 h-4" />
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

      <div className="divide-y divide-border">
        {controller.containers.map((container) => (
          <RowFreshness
            key={container.id}
            readAt={controller.containerReadAt}
            surfaceReadAt={controller.surfaceReadAt}
            streamStatus={controller.streamStatus}
          >
            <ContainerRow
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
          </RowFreshness>
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
    </div>
  );
}

/**
 * What can be done to a whole stack, below the rows it applies to.
 *
 * WHY below: these controls restart or rebuild groups of the rows above, so they are read after them
 * - and they are not a row of the table, so they do not belong inside its card.
 */
export function ContainerStacks(): React.JSX.Element {
  const controller = useContainers();
  return (
    <ContainerStackControls
      containers={controller.containers}
      loading={controller.loading}
      actionLoading={controller.actionLoading}
      onCompose={controller.handleCompose}
    />
  );
}
