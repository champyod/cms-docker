'use client';

import { useState, useEffect } from 'react';
import { Dialog } from '@/components/core/Dialog';
import { Button } from '@/components/core/Button';
import { cn } from '@/lib/utils';
import { Power, RotateCcw, Bell, AlertTriangle } from 'lucide-react';
import { updateContainerConfig, resetRestartCount } from '@/app/actions/containerConfig';
import { getDiscordWebhookStatus } from '@/lib/discord-notifier';
import { toast } from 'sonner';

interface ContainerSettingsModalProps {
  containerId: string;
  containerName: string;
  config: {
    autoRestart: boolean;
    maxRestarts: number;
    currentRestarts: number;
    discordNotifications: boolean;
  };
  onClose: () => void;
  onUpdate: () => void;
}

export function ContainerSettingsModal({
  containerId,
  containerName,
  config,
  onClose,
  onUpdate
}: ContainerSettingsModalProps) {
  const [autoRestart, setAutoRestart] = useState(config.autoRestart);
  const [maxRestarts, setMaxRestarts] = useState(config.maxRestarts);
  const [discordNotifications, setDiscordNotifications] = useState(config.discordNotifications ?? true);
  const [saving, setSaving] = useState(false);
  const [isDiscordConfigured, setIsDiscordConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    getDiscordWebhookStatus().then((status) => setIsDiscordConfigured(status.configured)).catch(() => setIsDiscordConfigured(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const res = await updateContainerConfig(containerId, {
      autoRestart,
      maxRestarts,
      discordNotifications,
    });

    if (res.success) {
      toast.success('Success', { description: 'Container settings updated' });
      if (isDiscordConfigured === false && discordNotifications) {
        toast.warning('Discord not configured', { description: 'Webhook is empty — notifications will be skipped until configured.' });
      }
      onUpdate();
      onClose();
    } else {
      toast.error('Error', { description: res.error });
    }
    setSaving(false);
  };

  const handleReset = async () => {
    const res = await resetRestartCount(containerId);
    if (res.success) {
      toast.success('Success', { description: 'Restart count reset to 0' });
      onUpdate();
      onClose();
    } else {
      toast.error('Error', { description: res.error });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Container Settings"
      description={containerName}
      className="max-w-lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end w-full">
          <Button variant="secondary" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset Restart Count
          </Button>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-bold text-foreground flex items-center gap-2">
                <Power className="w-4 h-4 text-success" />
                Auto-Restart Policy
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically restart container on failure
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoRestart}
              aria-label={`Auto-restart ${autoRestart ? 'enabled' : 'disabled'} — click to ${autoRestart ? 'disable' : 'enable'}`}
              onClick={() => setAutoRestart(!autoRestart)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <span
                className={cn(
                  'pointer-events-none relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  autoRestart ? 'bg-success' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-card transition-transform',
                    autoRestart ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </span>
            </button>
          </div>

          {!autoRestart && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-xs text-warning flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Container will NOT restart automatically on failure. You must start it manually via the UI.
              </p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="text-sm font-bold text-foreground flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-primary" />
            Maximum Restart Attempts
          </label>
          <p className="text-xs text-muted-foreground">
            Container will stop auto-restarting after this many failed attempts
          </p>
          <input
            type="number"
            min="1"
            max="20"
            value={maxRestarts}
            onChange={(e) => setMaxRestarts(parseInt(e.target.value) || 5)}
            className="w-full bg-background/80 border border-border rounded-lg px-4 py-2 text-foreground focus:outline-none focus:border-ring"
          />
          <p className="text-xs text-muted-foreground">
            Recommended: 5 attempts. Range: 1-20.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-bold text-foreground flex items-center gap-2">
                <Bell className="w-4 h-4 text-info" />
                Discord Notifications
                {isDiscordConfigured === false && (
                  <span className="px-2 py-0.5 bg-warning/10 border border-warning/20 text-warning text-xs font-bold rounded-full">Discord not configured</span>
                )}
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Send container events (start/stop/die/restart) to Discord webhook
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={discordNotifications}
              aria-label={`Discord notifications ${discordNotifications ? 'enabled' : 'disabled'} — click to ${discordNotifications ? 'disable' : 'enable'}`}
              onClick={() => setDiscordNotifications(!discordNotifications)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <span
                className={cn(
                  'pointer-events-none relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                  discordNotifications ? 'bg-info' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-card transition-transform',
                    discordNotifications ? 'translate-x-6' : 'translate-x-1'
                  )}
                />
              </span>
            </button>
          </div>

          {!discordNotifications && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-xs text-warning flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Discord notifications disabled. Container events will not be sent to webhook.
              </p>
            </div>
          )}
          {isDiscordConfigured === false && discordNotifications && (
            <div className="bg-warning/10 border border-warning/20 rounded-lg p-3">
              <p className="text-xs text-warning flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Discord webhook is not configured. Notifications will be skipped until DISCORD_WEBHOOK_URL is set.
              </p>
            </div>
          )}
        </div>
        <div className="bg-muted/40 border border-border rounded-lg p-4 space-y-2">
          <div className="text-xs font-bold text-muted-foreground">CURRENT STATUS</div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Auto-Restart</span>
            <span className={cn('text-sm font-bold', config.autoRestart ? 'text-success' : 'text-muted-foreground')}>
              {config.autoRestart ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Restart Count</span>
            <span className={cn('text-sm font-bold', config.currentRestarts >= config.maxRestarts ? 'text-destructive' : 'text-primary')}>
              {config.currentRestarts} / {config.maxRestarts}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Discord Alerts</span>
            <span className={cn('text-sm font-bold', config.discordNotifications ? 'text-info' : 'text-muted-foreground')}>
              {config.discordNotifications ? 'ENABLED' : 'DISABLED'}
            </span>
          </div>
          {config.currentRestarts >= config.maxRestarts && (
            <div className="bg-destructive/10 border border-destructive/20 rounded p-2 mt-2">
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Restart limit reached! Container will not auto-restart until count is reset.
              </p>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
