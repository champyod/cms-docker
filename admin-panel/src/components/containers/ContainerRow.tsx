'use client';

import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
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
      case 'running': return 'text-success bg-success/10 border-success/20';
      case 'exited': return 'text-destructive bg-destructive/10 border-destructive/20';
      case 'paused': return 'text-warning bg-warning/10 border-warning/20';
      default: return 'text-muted-foreground bg-muted/40 border-border';
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
    <div data-shortcut-row className="p-4 hover:bg-muted/30 transition-colors group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <div className={cn('w-2 h-2 rounded-full', container.state === 'running' ? 'bg-success animate-pulse' : 'bg-destructive')} />
          <div>
            <div className="font-bold text-foreground text-sm group-hover:text-primary transition-colors flex items-center gap-2">
              {container.name}
              {!container.isCmsContainer && (
                <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-[9px] rounded uppercase font-bold">External</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{container.image} • {container.id.substring(0, 12)}</div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusColor(container.state)}`}>
            {container.state.toUpperCase()}
          </div>

          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="ghost"
              icon={Terminal}
              tooltip="View Logs"
              onClick={() => onViewLogs({ id: container.id, name: container.name })}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Settings}
              tooltip="Container Settings"
              onClick={() => onOpenSettings({ id: container.id, name: container.name })}
            />
            {container.state !== 'running' ? (
              <Button
                size="sm"
                variant="positiveOutline"
                icon={Play}
                tooltip="Start Container"
                onClick={() => onControl(container.id, 'start')}
                disabled={actionLoading === container.id}
              />
            ) : (
              <Button
                size="sm"
                variant="negative"
                icon={Square}
                tooltip="Stop Container"
                onClick={() => onControl(container.id, 'stop')}
                disabled={actionLoading === container.id}
              />
            )}
            <Button
              size="sm"
              variant="positiveOutline"
              icon={RotateCcw}
              tooltip="Restart Container"
              onClick={() => onControl(container.id, 'restart')}
              disabled={actionLoading === container.id}
            />
          </div>
        </div>
      </div>

      {container.isCmsContainer && (
        <div className="flex items-center gap-3 ml-6 text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleAutoRestart(container.id, autoRestartEnabled)}
              className={cn(
                'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                autoRestartEnabled ? 'bg-success' : 'bg-muted'
              )}
              title={`Auto-restart: ${autoRestartEnabled ? 'Enabled' : 'Disabled'}`}
            >
              <span
                className={cn(
                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                  autoRestartEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                )}
              />
            </button>
            <span className="text-muted-foreground">
              Auto-restart: <span className={autoRestartEnabled ? 'text-success' : 'text-muted-foreground'}>
                {autoRestartEnabled ? 'ON' : 'OFF'}
              </span>
            </span>
          </div>

          <div className="text-muted-foreground">•</div>

          <div className={maxRestartsReached ? 'text-destructive' : 'text-muted-foreground'}>
            Restarts: {restartCount} / {config.maxRestarts}
          </div>

          {maxRestartsReached && (
            <>
              <div className="text-destructive">• Limit reached!</div>
              <button
                onClick={() => onResetRestartCount(container.id)}
                className="text-primary hover:text-primary/80 underline"
              >
                Reset
              </button>
            </>
          )}

          <div className="text-muted-foreground">•</div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleDiscordNotifications(container.id, discordEnabled)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded transition-colors',
                discordEnabled
                  ? 'bg-info/10 text-info hover:bg-info/20'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              )}
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
