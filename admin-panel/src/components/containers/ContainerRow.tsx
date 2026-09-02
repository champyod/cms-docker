'use client';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { ContainerInfo } from '@/app/actions/docker';
import { Play, Square, RotateCcw, Terminal, Settings, Bell, BellOff, Check } from 'lucide-react';
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
  isSelected?: boolean;
  onToggleSelection?: (containerId: string) => void;
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
  onToggleDiscordNotifications,
  isSelected = false,
  onToggleSelection
}: ContainerRowProps) {
  const autoRestartEnabled = config.autoRestart ?? false;
  const maxRestartsReached = restartCount >= config.maxRestarts;
  const discordEnabled = config.discordNotifications ?? true;

  // Why: entire row clickable with 32px hit area checkbox keeps table selection consistent across all tables
  // and avoids forcing tiny checkbox targets; low-contrast border reduces visual noise when unselected,
  // primary ring signals active selection without overwhelming the row.
  const handleRowClick = (): void => {
    if (onToggleSelection) onToggleSelection(container.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!onToggleSelection) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggleSelection(container.id);
    }
  };

  const handleCheckboxClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (onToggleSelection) onToggleSelection(container.id);
  };

  const stopPropagation = (event: React.MouseEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      data-shortcut-row
      role={onToggleSelection ? 'button' : undefined}
      tabIndex={onToggleSelection ? 0 : undefined}
      onClick={onToggleSelection ? handleRowClick : undefined}
      onKeyDown={onToggleSelection ? handleKeyDown : undefined}
      aria-selected={onToggleSelection ? isSelected : undefined}
      className={cn(
        'p-4 hover:bg-muted/30 transition-colors group cursor-pointer flex items-center gap-3',
        isSelected && 'bg-primary/5 border-l-2 border-l-primary'
      )}
    >
      {onToggleSelection && (
        <button
          type="button"
          aria-label={`Select ${container.name}`}
          aria-checked={isSelected}
          role="checkbox"
          onClick={handleCheckboxClick}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded border-2 transition-colors',
              isSelected
                ? 'bg-primary border-primary text-primary-foreground ring-2 ring-primary/20'
                : 'border-border bg-transparent hover:border-muted-foreground/30'
            )}
          >
            {isSelected && <Check className="h-3 w-3" aria-hidden />}
          </span>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <div className={cn('w-2 h-2 rounded-full', container.state === 'running' ? 'bg-success animate-pulse' : 'bg-destructive')} />
            <div>
              <div className="font-bold text-foreground text-sm group-hover:text-primary transition-colors flex items-center gap-2">
                {container.name}
                {!container.isCmsContainer && (
                  <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded uppercase font-bold">External</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground font-mono mt-0.5">{container.image} • {container.id.substring(0, 12)}</div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className={`px-2 py-0.5 rounded text-xs font-bold border ${getStatusColor(container.state)}`}>
              {container.state.toUpperCase()}
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={stopPropagation}>
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
          <div className="flex items-center gap-3 ml-6 text-xs" onClick={stopPropagation}>
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
                    'inline-block h-3 w-3 transform rounded-full bg-card transition-transform',
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
                <span className="text-xs font-bold">Discord</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
