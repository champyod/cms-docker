'use client';

import { Bell, RefreshCw, Save, Send, Shield } from 'lucide-react';

import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Input } from '@/components/core/Input';
import { DeploymentModeNote } from '@/components/settings/MaintenanceControls';
import type { MaintenanceController } from '@/components/system/maintenance-types';

const MONITORED_EVENTS = [
  'Container Status (Start, Stop, Die, Restart)',
  'Resource Alerts (CPU, Memory, Disk)',
  'Backup Results (Success/Failure)',
  'Admin Panel Actions (Switch Contest, manual restarts)',
] as const;

function NotificationStatus({ controller }: { readonly controller: MaintenanceController }): React.JSX.Element | null {
  if (controller.discordError) {
    return <Text variant="small" color="text-destructive">{controller.discordError}</Text>;
  }
  if (!controller.discordState) return null;
  return <Text variant="small" color="text-muted-foreground">{controller.discordState}</Text>;
}

function MonitoringSummary(): React.JSX.Element {
  return (
    <Stack gap={2} className="p-4 bg-muted/50 rounded-xl border border-border">
      <Stack direction="row" align="center" gap={2} className="mb-2">
        <Shield className="w-4 h-4 text-indigo-400" />
        <Text variant="h4">Active Monitoring</Text>
      </Stack>
      <ul className="text-xs text-muted-foreground space-y-2">
        {MONITORED_EVENTS.map((event) => (
          <li key={event} className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-indigo-500" />
            {event}
          </li>
        ))}
      </ul>
    </Stack>
  );
}

export function MaintenanceNotificationsCard({
  controller,
}: {
  readonly controller: MaintenanceController;
}): React.JSX.Element {
  const { data, handleChange, persistDiscordSettings, discordSaving, canConfigure, canTestAlert, handleTestAlert, discordTesting } = controller;
  return (
    <Stack gap={6}>
      <Card className="p-6 h-full">
        <Stack direction="row" align="center" gap={3} className="mb-6">
          <div className="p-2 bg-indigo-500/10 rounded-lg">
            <Bell className="w-5 h-5 text-indigo-400" />
          </div>
          <Text variant="h2">Discord Notifications</Text>
        </Stack>

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

          <Stack gap={3} className="pt-4 border-t border-border">
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
            <NotificationStatus controller={controller} />
            <Text variant="small" color="text-muted-foreground" className="italic opacity-50">
              The test alert uses the URL in the field above, so you can verify before saving.
            </Text>
          </Stack>

          <MonitoringSummary />
        </Stack>
      </Card>
    </Stack>
  );
}
