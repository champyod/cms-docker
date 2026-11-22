'use client';

import { RefreshCw, Save, Send, Shield } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Input } from '@/components/core/Input';
import { DeploymentModeNote } from '@/components/settings/MaintenanceControls';
import { useMaintenance } from '@/components/system/MaintenanceSurface';

const MONITORED_EVENTS = [
  'Container Status (Start, Stop, Die, Restart)',
  'Resource Alerts (CPU, Memory, Disk)',
  'Backup Results (Success/Failure)',
  'Admin Panel Actions (Switch Contest, manual restarts)',
] as const;

function NotificationStatus(): React.JSX.Element | null {
  const { discordError, discordState } = useMaintenance();
  if (discordError) {
    return <Text variant="small" color="text-destructive">{discordError}</Text>;
  }
  if (!discordState) return null;
  return <Text variant="small" color="text-muted-foreground">{discordState}</Text>;
}

function MonitoringSummary(): React.JSX.Element {
  return (
    <Stack gap={2} className="rounded-xl border border-border bg-muted/50 p-4">
      <Stack direction="row" align="center" gap={2} className="mb-2">
        <Shield className="w-4 h-4 text-muted-foreground" />
        <Text variant="h4">Active Monitoring</Text>
      </Stack>
      <ul className="space-y-2 text-xs text-muted-foreground">
        {MONITORED_EVENTS.map((event) => (
          <li key={event} className="flex items-center gap-2">
            <span className="h-1 w-1 rounded-full bg-muted-foreground" />
            {event}
          </li>
        ))}
      </ul>
    </Stack>
  );
}

/**
 * Where the alerts go, and what the monitor raises.
 *
 * WHY this group saves itself: the webhook and the role id are written by their own press, with the
 * restart decision beside them, so the page's save bar cannot speak for them. The layout frames the
 * group and names it, so the panel carries no card and no title of its own.
 */
export function MaintenanceNotificationsCard(): React.JSX.Element {
  const { data, handleChange, persistDiscordSettings, discordSaving, canConfigure, canTestAlert, handleTestAlert, discordTesting } = useMaintenance();
  return (
    <Stack gap={6}>
      <Stack gap={4}>
        <Input
          label="Webhook URL"
          type="password"
          value={data['DISCORD_WEBHOOK_URL'] || ''}
          onChange={(event) => handleChange('DISCORD_WEBHOOK_URL', event.target.value)}
          className="font-mono text-sm"
          placeholder="https://discord.com/api/webhooks/..."
        />
        <Input
          label="Mention Role ID (Optional)"
          value={data['DISCORD_ROLE_ID'] || ''}
          onChange={(event) => handleChange('DISCORD_ROLE_ID', event.target.value)}
          className="font-mono text-sm"
          placeholder="Role ID to tag in alerts"
        />
      </Stack>

      <Stack gap={3} className="border-t border-border pt-4">
        {/* 'Save & Restart Monitor' runs the same deployment-mode-aware restart. */}
        <DeploymentModeNote />
        <Stack direction="row" gap={2} className="flex-wrap">
          <Button
            variant="positiveOutline"
            onClick={() => void persistDiscordSettings(false)}
            disabled={!canConfigure}
            loading={discordSaving}
          >
            <Save className="w-4 h-4" />
            Save Notifications
          </Button>
          {canTestAlert && (
            <Button
              variant="secondary"
              onClick={handleTestAlert}
              disabled={!canConfigure}
              loading={discordTesting}
            >
              <Send className="w-4 h-4" />
              Send Test Alert
            </Button>
          )}
          <Button
            variant="positive"
            onClick={() => void persistDiscordSettings(true)}
            disabled={!canConfigure}
            loading={discordSaving}
          >
            <RefreshCw className="w-4 h-4" />
            Save & Restart Monitor
          </Button>
        </Stack>
        <NotificationStatus />
        <Text variant="small" color="text-muted-foreground" className="italic opacity-50">
          The test alert uses the URL in the field above, so you can verify before saving.
        </Text>
      </Stack>

      <MonitoringSummary />
    </Stack>
  );
}
