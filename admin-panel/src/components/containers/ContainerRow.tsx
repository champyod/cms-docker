'use client';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { ContainerInfo } from '@/app/actions/docker';
import { Play, Square, RotateCcw, ScrollText, Settings, Bell, BellOff, Check } from 'lucide-react';

type ContainerRef = { id: string; name: string };

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

function ContainerIdentity({ container }: { container: ContainerInfo }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className={cn('w-2 h-2 shrink-0 rounded-full', container.state === 'running' ? 'bg-success animate-pulse' : 'bg-destructive')} />
      <div className="min-w-0">
        <div className="font-bold text-foreground text-sm group-hover:text-primary transition-colors flex flex-wrap items-center gap-2">
          <span className="truncate">{container.name}</span>
          {!container.isCmsContainer && <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded uppercase font-bold">External</span>}
        </div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5 truncate">{container.image} • {container.id.substring(0, 12)}</div>
      </div>
    </div>
  );
}

function ContainerActions({
  container,
  actionLoading,
  onViewLogs,
  onOpenSettings,
  onControl,
  stopPropagation,
}: {
  container: ContainerInfo;
  actionLoading: string | null;
  onViewLogs: (ref: ContainerRef) => void;
  onOpenSettings: (ref: ContainerRef) => void;
  onControl: (id: string, action: 'start' | 'stop' | 'restart') => void;
  stopPropagation: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-4 sm:justify-end">
      <div className={cn('px-2 py-0.5 rounded text-xs font-bold border', getStatusColor(container.state))}>{container.state.toUpperCase()}</div>
      <div className="flex flex-wrap items-center gap-2" onClick={stopPropagation}>
        <Button size="sm" variant="ghost" icon={ScrollText} tooltip="View Logs" className="shrink-0" onClick={() => onViewLogs({ id: container.id, name: container.name })} />
        <Button size="sm" variant="ghost" icon={Settings} tooltip="Container Settings" className="shrink-0" onClick={() => onOpenSettings({ id: container.id, name: container.name })} />
        {container.state !== 'running' ? (
          <Button size="sm" variant="positiveOutline" icon={Play} tooltip="Start Container" className="shrink-0" onClick={() => onControl(container.id, 'start')} disabled={actionLoading === container.id} />
        ) : (
          <Button size="sm" variant="negative" icon={Square} tooltip="Stop Container" className="shrink-0" onClick={() => onControl(container.id, 'stop')} disabled={actionLoading === container.id} />
        )}
        <Button size="sm" variant="positiveOutline" icon={RotateCcw} tooltip="Restart Container" className="shrink-0" onClick={() => onControl(container.id, 'restart')} disabled={actionLoading === container.id} />
      </div>
    </div>
  );
}

function ContainerMainRow(props: {
  container: ContainerInfo;
  actionLoading: string | null;
  onViewLogs: (ref: ContainerRef) => void;
  onOpenSettings: (ref: ContainerRef) => void;
  onControl: (id: string, action: 'start' | 'stop' | 'restart') => void;
  stopPropagation: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
      <ContainerIdentity container={props.container} />
      <ContainerActions container={props.container} actionLoading={props.actionLoading} onViewLogs={props.onViewLogs} onOpenSettings={props.onOpenSettings} onControl={props.onControl} stopPropagation={props.stopPropagation} />
    </div>
  );
}

function RestartToggle({ containerId, enabled, onToggle }: { containerId: string; enabled: boolean; onToggle: (id: string, value: boolean) => void }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button type="button" role="switch" aria-checked={enabled} aria-label={`Auto-restart ${enabled ? 'enabled' : 'disabled'} — click to ${enabled ? 'disable' : 'enable'}`} onClick={() => onToggle(containerId, enabled)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1" title={`Auto-restart: ${enabled ? 'Enabled' : 'Disabled'}`}>
        <span className={cn('pointer-events-none relative inline-flex h-4 w-7 items-center rounded-full transition-colors', enabled ? 'bg-success' : 'bg-muted')}>
          <span className={cn('inline-block h-3 w-3 transform rounded-full bg-card transition-transform', enabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
        </span>
      </button>
      <span className="text-muted-foreground">Auto-restart: <span className={enabled ? 'text-success' : 'text-muted-foreground'}>{enabled ? 'ON' : 'OFF'}</span></span>
    </div>
  );
}

function DiscordToggle({ containerId, enabled, onToggle }: { containerId: string; enabled: boolean; onToggle: (id: string, value: boolean) => void }): React.JSX.Element {
  return (
    <button type="button" onClick={() => onToggle(containerId, enabled)} className={cn('flex items-center gap-1 px-2 min-h-11 rounded transition-colors', enabled ? 'bg-info/10 text-info hover:bg-info/20' : 'bg-muted text-muted-foreground hover:bg-accent')} title={`Discord notifications: ${enabled ? 'Enabled' : 'Disabled'}`}>
      {enabled ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
      <span className="text-xs font-bold">Discord</span>
    </button>
  );
}

function ContainerMetaRow({
  container,
  config,
  restartCount,
  onToggleAutoRestart,
  onResetRestartCount,
  onToggleDiscordNotifications,
  stopPropagation,
}: {
  container: ContainerInfo;
  config: ContainerRestartSettings;
  restartCount: number;
  onToggleAutoRestart: (id: string, value: boolean) => void;
  onResetRestartCount: (id: string) => void;
  onToggleDiscordNotifications: (id: string, value: boolean) => void;
  stopPropagation: (event: React.MouseEvent) => void;
}): React.JSX.Element | null {
  if (!container.isCmsContainer) return null;
  const autoRestartEnabled = config.autoRestart ?? false;
  const maxRestartsReached = restartCount >= config.maxRestarts;
  const discordEnabled = config.discordNotifications ?? true;
  return (
    <div className="flex flex-wrap items-center gap-2 ml-6 text-xs" onClick={stopPropagation}>
      <RestartToggle containerId={container.id} enabled={autoRestartEnabled} onToggle={onToggleAutoRestart} />
      <div className="text-muted-foreground">•</div>
      <div className={maxRestartsReached ? 'text-destructive' : 'text-muted-foreground'}>Restarts: {restartCount} / {config.maxRestarts}</div>
      {maxRestartsReached && (
        <>
          <div className="text-destructive">• Limit reached!</div>
          <button onClick={() => onResetRestartCount(container.id)} className="text-primary hover:text-primary/80 underline">Reset</button>
        </>
      )}
      <div className="text-muted-foreground">•</div>
      <div className="flex items-center gap-2">
        <DiscordToggle containerId={container.id} enabled={discordEnabled} onToggle={onToggleDiscordNotifications} />
      </div>
    </div>
  );
}

function SelectionCheckbox({ name, isSelected, onToggle }: { name: string; isSelected: boolean; onToggle: (id: string) => void }): React.JSX.Element {
  const handleClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onToggle(name);
  };
  return (
    <button type="button" aria-label={`Select ${name}`} aria-checked={isSelected} role="checkbox" onClick={handleClick} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
      <span className={cn('flex h-5 w-5 items-center justify-center rounded border-2 transition-colors', isSelected ? 'bg-primary border-primary text-primary-foreground ring-2 ring-primary/20' : 'border-border bg-transparent hover:border-muted-foreground/30')}>
        {isSelected && <Check className="h-3 w-3" aria-hidden />}
      </span>
    </button>
  );
}

export function ContainerRow({ container, config, restartCount, actionLoading, onViewLogs, onOpenSettings, onControl, onToggleAutoRestart, onResetRestartCount, onToggleDiscordNotifications, isSelected = false, onToggleSelection }: ContainerRowProps): React.JSX.Element {
  // Why: row clickable + 32px checkbox keeps selection consistent; low-contrast border + primary ring avoids noise.
  const handleRowClick = (): void => { if (onToggleSelection) onToggleSelection(container.id); };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!onToggleSelection) return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggleSelection(container.id); }
  };
  const stopPropagation = (event: React.MouseEvent): void => { event.stopPropagation(); };
  return (
    <div data-shortcut-row role={onToggleSelection ? 'button' : undefined} tabIndex={onToggleSelection ? 0 : undefined} onClick={onToggleSelection ? handleRowClick : undefined} onKeyDown={onToggleSelection ? handleKeyDown : undefined} aria-selected={onToggleSelection ? isSelected : undefined} className={cn('p-4 hover:bg-muted/30 transition-colors group cursor-pointer flex items-center gap-3', isSelected && 'bg-primary/5 border-l-2 border-l-primary')}>
      {onToggleSelection && <SelectionCheckbox name={container.name} isSelected={isSelected} onToggle={() => onToggleSelection(container.id)} />}
      <div className="flex-1 min-w-0">
        <ContainerMainRow container={container} actionLoading={actionLoading} onViewLogs={onViewLogs} onOpenSettings={onOpenSettings} onControl={onControl} stopPropagation={stopPropagation} />
        <ContainerMetaRow container={container} config={config} restartCount={restartCount} onToggleAutoRestart={onToggleAutoRestart} onResetRestartCount={onResetRestartCount} onToggleDiscordNotifications={onToggleDiscordNotifications} stopPropagation={stopPropagation} />
      </div>
    </div>
  );
}
