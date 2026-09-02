'use client';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { SkeletonTable } from '@/components/core/Skeleton';
import { Box, CheckCircle2, AlertCircle, RotateCcw, Layers } from 'lucide-react';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { StatsCard } from '@/components/containers/StatsCard';
import type { ContainerInfo } from '@/app/actions/docker';
import type { ContainerRestartConfig } from '@/app/actions/containerConfig';

interface ContainerGridProps {
  containers: ContainerInfo[];
  loading: boolean;
  containerConfig: ContainerRestartConfig;
  restartCounts: Record<string, number>;
  actionLoading: string | null;
  selectedIds: Set<string>;
  onViewLogs: (ref: { id: string; name: string }) => void;
  onOpenSettings: (ref: { id: string; name: string }) => void;
  onControl: (id: string, action: 'start' | 'stop' | 'restart') => void;
  onToggleAutoRestart: (containerId: string, currentValue: boolean) => void;
  onResetRestartCount: (containerId: string) => void;
  onToggleDiscordNotifications: (containerId: string, currentValue: boolean) => void;
  onToggleSelection: (containerId: string) => void;
}

export function ContainerGrid({
  containers,
  loading,
  containerConfig,
  restartCounts,
  actionLoading,
  selectedIds,
  onViewLogs,
  onOpenSettings,
  onControl,
  onToggleAutoRestart,
  onResetRestartCount,
  onToggleDiscordNotifications,
  onToggleSelection,
}: ContainerGridProps): React.JSX.Element {
  const runningCount = containers.filter((container) => container.state === 'running').length;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Box} label="Total" value={containers.length} color="primary" />
        <StatsCard icon={CheckCircle2} label="Running" value={runningCount} color="success" />
        <StatsCard icon={AlertCircle} label="Stopped" value={containers.length - runningCount} color="destructive" />
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
              config={
                containerConfig[container.id] || {
                  autoRestart: false,
                  maxRestarts: 5,
                  currentRestarts: 0,
                  discordNotifications: true,
                }
              }
              restartCount={restartCounts[container.id] || 0}
              actionLoading={actionLoading}
              onViewLogs={onViewLogs}
              onOpenSettings={onOpenSettings}
              onControl={onControl}
              onToggleAutoRestart={onToggleAutoRestart}
              onResetRestartCount={onResetRestartCount}
              onToggleDiscordNotifications={onToggleDiscordNotifications}
              isSelected={selectedIds.has(container.id)}
              onToggleSelection={onToggleSelection}
            />
          ))}
          {containers.length === 0 && loading && (
            <div className="p-6">
              <SkeletonTable rows={4} cols={1} />
            </div>
          )}
          {containers.length === 0 && !loading && (
            <EmptyState icon={Box} title="No Docker containers found on this host." className="border-none" />
          )}
        </div>
      </Card>
    </>
  );
}
