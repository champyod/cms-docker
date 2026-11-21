'use client';

import { Bell } from 'lucide-react';
import { InlineAlert } from '@/components/core/InlineAlert';
import { cn } from '@/lib/utils';

interface ContainerDiscordSectionProps {
  discordNotifications: boolean;
  isDiscordConfigured: boolean | null;
  onToggle: () => void;
}

export function ContainerDiscordSection({
  discordNotifications,
  isDiscordConfigured,
  onToggle,
}: ContainerDiscordSectionProps): React.JSX.Element {
  return (
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
          onClick={onToggle}
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
        <InlineAlert tone="warning" density="compact">
          Discord notifications disabled. Container events will not be sent to webhook.
        </InlineAlert>
      )}
      {isDiscordConfigured === false && discordNotifications && (
        <InlineAlert tone="warning" density="compact">
          Discord webhook is not configured. Notifications will be skipped until DISCORD_WEBHOOK_URL is set.
        </InlineAlert>
      )}
    </div>
  );
}
