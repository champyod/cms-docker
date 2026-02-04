'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import {
  Play, Square, RotateCcw, Box, RefreshCw,
  CheckCircle2, AlertCircle, Layers, Terminal, HelpCircle, Settings, Bell, BellOff
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
import { LogViewerModal } from '@/components/containers/LogViewerModal';
import { ContainerSettingsModal } from '@/components/containers/ContainerSettingsModal';
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
    } catch (error) {
      addToast({
        title: 'Error',
        message: 'Permission denied. Requires superadmin access.',
        type: 'error'
      });
    }
    setLoading(false);
  };

  useEffect(() => {
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

  const handleCompose = async (action: 'up' | 'down' | 'restart' | 'build', type?: any) => {
    setActionLoading('compose');
    const res = await runCompose(action, type);
    if (res.success) {
      addToast({ title: 'Success', message: `Compose ${action} completed`, type: 'success' });
      loadContainers();
    } else {
      addToast({ title: 'Error', message: res.error, type: 'error' });
    }
    setActionLoading(null);
  };

  const getStatusColor = (state: string) => {
    switch (state.toLowerCase()) {
      case 'running': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'exited': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'paused': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      default: return 'text-neutral-400 bg-neutral-400/10 border-neutral-400/20';
    }
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
            <h1 className="text-3xl font-bold text-white tracking-tight">Container Control Center</h1>
            <Link href={`/${locale}/docs#services`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation">
              <HelpCircle className="w-5 h-5" />
            </Link>
          </div>
          <p className="text-neutral-400 mt-1">Manage and monitor Docker services in real-time.</p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => handleCompose('up')}
            disabled={actionLoading === 'compose'}
            className="bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            <Layers className="w-4 h-4 mr-2" /> Up All
          </Button>
          <Button
            variant="secondary"
            onClick={loadContainers}
            disabled={loading}
            className="border-white/10 text-white hover:bg-white/5"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard icon={Box} label="Total" value={containers.length} color="indigo" />
        <StatsCard icon={CheckCircle2} label="Running" value={containers.filter(c => c.state === 'running').length} color="emerald" />
        <StatsCard icon={AlertCircle} label="Stopped" value={containers.filter(c => c.state !== 'running').length} color="red" />
        <StatsCard icon={RotateCcw} label="Uptime" value="99.9%" color="blue" />
      </div>

      <Card className="glass-card border-white/5 overflow-hidden">
        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                Active Containers
            </h2>
        </div>
        <div className="divide-y divide-white/5">
          {containers.map((container) => {
            const config = containerConfig[container.id] || { autoRestart: false, maxRestarts: 5, currentRestarts: 0, discordNotifications: true };
            const restartCount = restartCounts[container.id] || 0;
            const autoRestartEnabled = config.autoRestart;
            const maxRestartsReached = restartCount >= config.maxRestarts;
            const discordEnabled = config.discordNotifications ?? true;

            return (
              <div key={container.id} className="p-4 hover:bg-white/[0.02] transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full ${container.state === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <div>
                      <div className="font-bold text-white text-sm group-hover:text-indigo-400 transition-colors flex items-center gap-2">
                        {container.name}
                        {!container.isCmsContainer && (
                          <span className="px-1.5 py-0.5 bg-neutral-700 text-neutral-400 text-[9px] rounded uppercase font-bold">External</span>
                        )}
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{container.image} • {container.id.substring(0, 12)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(container.state)}`}>
                      {container.state.toUpperCase()}
                    </div>

                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        size="sm"
                        onClick={() => setSelectedContainer({ id: container.id, name: container.name })}
                        className="p-2 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 border-0"
                        title="View Logs"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setSettingsContainer({ id: container.id, name: container.name })}
                        className="p-2 bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border-0"
                        title="Container Settings"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </Button>
                      {container.state !== 'running' ? (
                        <Button
                          size="sm"
                          onClick={() => handleControl(container.id, 'start')}
                          disabled={actionLoading === container.id}
                          className="p-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border-0"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleControl(container.id, 'stop')}
                          disabled={actionLoading === container.id}
                          className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 border-0"
                        >
                          <Square className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleControl(container.id, 'restart')}
                        disabled={actionLoading === container.id}
                        className="p-2 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/30 border-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>

                {container.isCmsContainer && (
                  <div className="flex items-center gap-3 ml-6 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleAutoRestart(container.id, autoRestartEnabled)}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                          autoRestartEnabled ? 'bg-emerald-600' : 'bg-neutral-700'
                        }`}
                        title={`Auto-restart: ${autoRestartEnabled ? 'Enabled' : 'Disabled'}`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                            autoRestartEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="text-neutral-400">
                        Auto-restart: <span className={autoRestartEnabled ? 'text-emerald-400' : 'text-neutral-500'}>
                          {autoRestartEnabled ? 'ON' : 'OFF'}
                        </span>
                      </span>
                    </div>

                    <div className="text-neutral-500">•</div>

                    <div className={`${maxRestartsReached ? 'text-red-400' : 'text-neutral-400'}`}>
                      Restarts: {restartCount} / {config.maxRestarts}
                    </div>

                    {maxRestartsReached && (
                      <>
                        <div className="text-red-500">• Limit reached!</div>
                        <button
                          onClick={() => handleResetRestartCount(container.id)}
                          className="text-indigo-400 hover:text-indigo-300 underline"
                        >
                          Reset
                        </button>
                      </>
                    )}

                    <div className="text-neutral-500">•</div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleDiscordNotifications(container.id, discordEnabled)}
                        className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${
                          discordEnabled
                            ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                            : 'bg-neutral-700 text-neutral-500 hover:bg-neutral-600'
                        }`}
                        title={`Discord notifications: ${discordEnabled ? 'Enabled' : 'Disabled'}`}
                      >
                        {discordEnabled ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
                        <span className="text-[10px] font-bold">Discord</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {containers.length === 0 && !loading && (
            <div className="p-20 text-center text-neutral-500">
                <Box className="w-10 h-10 mx-auto mb-3 opacity-20" />
                No Docker containers found on this host.
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="p-6 glass-card border-white/5 space-y-4">
              <h3 className="font-bold text-white">Stack Controls</h3>
              <p className="text-sm text-neutral-400">Manage complete service groups via Docker Compose.</p>
              <div className="grid grid-cols-2 gap-3">
                  <StackActionBtn label="All Services" onRestart={() => handleCompose('restart')} onUp={() => handleCompose('up')} onBuild={() => handleCompose('build')} />
                  <StackActionBtn label="Core Stack" onRestart={() => handleCompose('restart', 'core')} onUp={() => handleCompose('up', 'core')} onBuild={() => handleCompose('build', 'core')} />
                  <StackActionBtn label="Admin Stack" onRestart={() => handleCompose('restart', 'admin')} onUp={() => handleCompose('up', 'admin')} onBuild={() => handleCompose('build', 'admin')} />
                  <StackActionBtn label="Worker Stack" onRestart={() => handleCompose('restart', 'worker')} onUp={() => handleCompose('up', 'worker')} onBuild={() => handleCompose('build', 'worker')} />
              </div>
          </Card>

          <Card className="p-6 glass-card border-white/5 space-y-4">
              <h3 className="font-bold text-white font-mono text-sm tracking-wider uppercase text-neutral-500">System Logs</h3>
              <div className="bg-black/40 rounded-xl p-4 h-40 font-mono text-xs overflow-y-auto text-neutral-400 border border-white/5">
                  <div className="text-indigo-400">[SYSTEM] Docker Control initialized...</div>
                  <div>[INFO] Monitoring {containers.length} containers</div>
                  {containers.filter(c => c.state !== 'running').map(c => (
                      <div key={c.id} className="text-amber-500/80">[WARN] Container {c.name} is {c.state}</div>
                  ))}
                  <div className="mt-2 text-neutral-600">Waiting for events...</div>
              </div>
          </Card>
      </div>
    </div>
  );
}

function StatsCard({ icon: Icon, label, value, color }: any) {
    const colors: any = {
        indigo: 'text-indigo-400 bg-indigo-400/10',
        emerald: 'text-emerald-400 bg-emerald-400/10',
        red: 'text-red-400 bg-red-400/10',
        blue: 'text-blue-400 bg-blue-400/10'
    };
    return (
        <Card className="p-4 bg-white/[0.02] border-white/5 flex items-center gap-4">
            <div className={`p-3 rounded-xl ${colors[color]}`}>
                <Icon className="w-5 h-5" />
            </div>
            <div>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-xs text-neutral-500 font-bold uppercase tracking-wider">{label}</div>
            </div>
        </Card>
    );
}

function StackActionBtn({ label, onRestart, onUp, onBuild }: any) {
    return (
        <div className="bg-black/20 p-3 rounded-xl border border-white/5 space-y-2">
            <div className="text-xs font-bold text-neutral-400">{label}</div>
            <div className="flex gap-1">
                <button onClick={onRestart} className="flex-1 p-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white transition-colors">Restart</button>
                <button onClick={onUp} className="flex-1 p-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white transition-colors">Up</button>
                <button onClick={onBuild} className="flex-1 p-1 bg-indigo-600/20 hover:bg-indigo-600/40 rounded text-[10px] text-indigo-400 transition-colors">Build</button>
            </div>
        </div>
    );
}
