'use client';

import { Button } from '@/components/core/Button';
import { ContainerInfo } from '@/app/actions/docker';
import { Play, Square, RotateCcw, Terminal, Settings, Bell, BellOff } from 'lucide-react';

interface ContainerRef {
  id: string;
  name: string;
}

interface ContainerRestartSettings {
  autoRestart: boolean;
  maxRestarts: number;
  currentRestarts: number;
  lastRestartTime?: number;
  discordNotifications: boolean;
}

interface ContainerRowProps {
  container: ContainerInfo;
  config: ContainerRestartSettings;
  restartCount: number;
  actionLoading: string | null;
  onViewLogs: (container: ContainerRef) => void;
  onOpenSettings: (container: ContainerRef) => void;
  onControl: (id: string, action: 'start' | 'stop' | 'restart') => void;
  onToggleAutoRestart: (containerId: string, currentValue: boolean) => void;
  onResetRestartCount: (containerId: string) => void;
  onToggleDiscordNotifications: (containerId: string, currentValue: boolean) => void;
}

function getStatusColor(state: string): string {
    switch (state.toLowerCase()) {
      case 'running': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'exited': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'paused': return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      default: return 'text-neutral-400 bg-neutral-400/10 border-neutral-400/20';
    }
}

export function ContainerRow({
  container,
  config,
  restartCount,
  actionLoading,
  onViewLogs,
  onOpenSettings,
  onControl,
  onToggleAutoRestart,
  onResetRestartCount,
  onToggleDiscordNotifications
}: ContainerRowProps) {
  const autoRestartEnabled = config.autoRestart ?? false;
  const maxRestartsReached = restartCount >= config.maxRestarts;
  const discordEnabled = config.discordNotifications ?? true;

  return (
    <div className="p-4 hover:bg-white/[0.02] transition-colors group">
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
              onClick={() => onViewLogs({ id: container.id, name: container.name })}
              className="p-2 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 border-0"
              title="View Logs"
            >
              <Terminal className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="sm"
              onClick={() => onOpenSettings({ id: container.id, name: container.name })}
              className="p-2 bg-purple-600/10 text-purple-400 hover:bg-purple-600/20 border-0"
              title="Container Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
            {container.state !== 'running' ? (
              <Button
                size="sm"
                onClick={() => onControl(container.id, 'start')}
                disabled={actionLoading === container.id}
                className="p-2 bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border-0"
              >
                <Play className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => onControl(container.id, 'stop')}
                disabled={actionLoading === container.id}
                className="p-2 bg-red-600/20 text-red-400 hover:bg-red-600/30 border-0"
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => onControl(container.id, 'restart')}
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
              onClick={() => onToggleAutoRestart(container.id, autoRestartEnabled)}
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
                onClick={() => onResetRestartCount(container.id)}
                className="text-indigo-400 hover:text-indigo-300 underline"
              >
                Reset
              </button>
            </>
          )}

          <div className="text-neutral-500">•</div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleDiscordNotifications(container.id, discordEnabled)}
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
}
