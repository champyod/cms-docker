'use client';
import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import {
  Box, RefreshCw, RotateCcw, CheckCircle2, AlertCircle,
  Layers, HelpCircle
} from 'lucide-react';
import Link from 'next/link';
import { getContainers, controlContainer, runCompose, ContainerInfo } from '@/app/actions/docker';
import {
  getContainerConfig,
  updateContainerConfig,
  resetRestartCount,
  getContainerRestartCount,
  syncContainerConfigWithDocker,
  ContainerRestartConfig
} from '@/app/actions/containerConfig';
import { useToast } from '@/components/providers/ToastProvider';
import { cn } from '@/lib/utils';
import { LogViewerModal } from '@/components/containers/LogViewerModal';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
import { StatsCard } from '@/components/containers/StatsCard';
import { StackActionBtn } from '@/components/containers/StackActionBtn';
import { SystemLogsPanel } from '@/components/containers/SystemLogsPanel';
import { ContainerRow } from '@/components/containers/ContainerRow';
import { EmptyState } from '@/components/core/EmptyState';
import { SkeletonTable } from '@/components/core/Skeleton';
import { usePathname } from 'next/navigation';

export function ContainersClient() {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<{ id: string, name: string } | null>(null);
  const [settingsContainer, setSettingsContainer] = useState<{ id: string, name: string } | null>(null);
  const [containerConfig, setContainerConfig] = useState<ContainerRestartConfig>({});
  const [restartCounts, setRestartCounts] = useState<Record<string, number>>({});
  const { addToast } = useToast();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';

  const loadContainers = async () => {
    setLoading(true);
    try {
      const data = await getContainers();
      setContainers(data);

      const config = await getContainerConfig();

      for (const container of data) {
        if (container.isCmsContainer && !config[container.id]) {
          await syncContainerConfigWithDocker(container.id);
        }
      }

      const updatedConfig = await getContainerConfig();
      setContainerConfig(updatedConfig);

      const counts: Record<string, number> = {};
      for (const container of data) {
        const count = await getContainerRestartCount(container.id);
        counts[container.id] = count;
      }
      setRestartCounts(counts);
    } catch {
      addToast({
        title: 'Error',
        message: 'Permission denied. Requires superadmin access.',
        type: 'error'
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-load or modal-reset pattern; behavior must not change
    loadContainers();
    const interval = setInterval(loadContainers, 10000);
    return () => clearInterval(interval);
  }, []);
  const handleControl = async (id: string, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(id);
    const res = await controlContainer(id, action);
    if (res.success) {
      addToast({ title: 'Success', message: `Container ${action}ed successfully`, type: 'success' });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
    setActionLoading(null);
  };

  const handleCompose = async (
    action: 'up' | 'down' | 'restart' | 'build',
    serviceType?: 'core' | 'admin' | 'contest' | 'worker'
  ) => {
    setActionLoading('compose');
    const res = await runCompose(action, serviceType);
    if (res.success) {
      addToast({ title: 'Success', message: `Compose ${action} completed`, type: 'success' });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
    setActionLoading(null);
  };

  const handleToggleAutoRestart = async (containerId: string, currentValue: boolean) => {
    const res = await updateContainerConfig(containerId, {
      autoRestart: !currentValue,
    });
    if (res.success) {
      addToast({
        title: 'Success',
        message: `Auto-restart ${!currentValue ? 'enabled' : 'disabled'}`,
        type: 'success'
      });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
  };

  const handleResetRestartCount = async (containerId: string) => {
    const res = await resetRestartCount(containerId);
    if (res.success) {
      addToast({ title: 'Success', message: 'Restart count reset', type: 'success' });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
  };

  const handleToggleDiscordNotifications = async (containerId: string, currentValue: boolean) => {
    const res = await updateContainerConfig(containerId, {
      discordNotifications: !currentValue,
    });
    if (res.success) {
      addToast({
        title: 'Success',
        message: `Discord notifications ${!currentValue ? 'enabled' : 'disabled'}`,
        type: 'success'
      });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
  };

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
          onUpdate={loadContainers}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">Container Control Center</h1>
            <Link href={`/${locale}/docs#services`} className="p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-foreground" title="View Documentation">
              <HelpCircle className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-muted-foreground mt-1">Manage and monitor Docker services in real-time.</p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => handleCompose('up')}
            disabled={actionLoading === 'compose'}
          >
            <Layers className="w-4 h-4 mr-2" /> Up All
          </Button>
          <Button
            variant="secondary"
            onClick={loadContainers}
            disabled={loading}
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

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
                  <StackActionBtn label="All Services" onRestart={() => handleCompose('restart')} onUp={() => handleCompose('up')} onBuild={() => handleCompose('build')} />
                  <StackActionBtn label="Core Stack" onRestart={() => handleCompose('restart', 'core')} onUp={() => handleCompose('up', 'core')} onBuild={() => handleCompose('build', 'core')} />
                  <StackActionBtn label="Admin Stack" onRestart={() => handleCompose('restart', 'admin')} onUp={() => handleCompose('up', 'admin')} onBuild={() => handleCompose('build', 'admin')} />
                  <StackActionBtn label="Worker Stack" onRestart={() => handleCompose('restart', 'worker')} onUp={() => handleCompose('up', 'worker')} onBuild={() => handleCompose('build', 'worker')} />
              </div>
          </Card>

          <SystemLogsPanel containers={containers} />
      </div>
    </div>
  );
}
