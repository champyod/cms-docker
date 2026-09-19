'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { Card } from '@/components/core/Card';
import { readConfigTomlValues, updateConfigTomlValues } from '@/app/actions/env';
import { buildConfigTomlUpdates, type ConfigTomlKey } from '@/lib/config-toml';
import { interpolate } from '@/lib/interpolate';
import { useConfirmationCopy } from '@/hooks/useConfirmationCopy';
import { useConfirm } from '@/hooks/useConfirm';
import { useDictionary } from '@/hooks/useDictionary';
import { triggerManualBackup, restartServices } from '@/app/actions/services';
import { hasEffectivePermission } from '@/lib/permission-engine';
import {
  getDiscordNotificationSettings,
  saveDiscordNotificationSettings,
  sendTestDiscordAlert,
} from '@/app/actions/notifications';
import { Save, Database, Bell, Shield, Zap, Send, RefreshCw } from 'lucide-react';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Loading } from '@/components/core/Loading';
import { DeploymentModeNote } from '@/components/settings/MaintenanceControls';
import { toast } from 'sonner';

interface DiscordSettings {
  configTomlPresent: boolean;
  configWebhookUrl: string;
  effectiveWebhookUrl: string;
}

// This screen edits config.toml [infra]: the generated .env is rewritten from it by
// ./cms config sync (update-server runs one on every deploy), so a backup policy written
// into .env alone would be gone before the monitor ever restarted with it.
const BACKUP_POLICY_KEYS: readonly ConfigTomlKey[] = [
  { section: 'infra', key: 'BACKUP_INTERVAL_MINS' },
  { section: 'infra', key: 'BACKUP_MAX_COUNT' },
  { section: 'infra', key: 'BACKUP_MAX_AGE_DAYS' },
  { section: 'infra', key: 'BACKUP_MAX_SIZE_GB' },
];

const NOTIFICATION_KEYS: readonly ConfigTomlKey[] = [
  { section: 'infra', key: 'DISCORD_WEBHOOK_URL' },
  { section: 'infra', key: 'DISCORD_ROLE_ID' },
];

const MAINTENANCE_CONFIG_KEYS: readonly ConfigTomlKey[] = [...BACKUP_POLICY_KEYS, ...NOTIFICATION_KEYS];

// Why: the source of truth (config.toml) and what the monitor actually reads (.env) can
// drift, and a silent drift means alerts vanish — spell the state out instead of a badge.
function describeDiscordState(settings: DiscordSettings): string {
  if (!settings.configTomlPresent) {
    return "config.toml not found — run './cms config sync' so saved values survive the next sync.";
  }
  if (settings.effectiveWebhookUrl === '' && settings.configWebhookUrl === '') {
    return 'No webhook configured — monitor alerts are dropped.';
  }
  if (settings.effectiveWebhookUrl === '') {
    return 'Saved in config.toml but not applied to .env yet — save and restart the monitor to apply it.';
  }
  if (settings.effectiveWebhookUrl !== settings.configWebhookUrl) {
    return 'config.toml and .env disagree — save here so the next config sync keeps this value.';
  }
  return 'Webhook configured and matching config.toml.';
}

export default function MaintenanceClient({ permissionKeys }: { permissionKeys: readonly string[] }) {
  const toasts = useDictionary().toasts.maintenance;
  // Why OR with maintenance:enable: pre-seed deployments hold enable but not
  // backup:create; the server action enforces the same pair, this only hides.
  const effective = useMemo(() => new Set(permissionKeys), [permissionKeys]);
  const canTriggerBackup =
    hasEffectivePermission(effective, 'backup:create') ||
    hasEffectivePermission(effective, 'maintenance:enable');
  const confirm = useConfirm();
  const { manualBackupConfirm } = useConfirmationCopy();
  // Why from the pathname: server actions localise their own messages, and a client component has no
  // other way to tell them which locale the admin is reading (same pattern the lists already use).
  const locale = usePathname().split('/')[1] || 'en';
  // Why these keys: the backup action enforces maintenance:enable and the test
  // alert enforces monitor:test, while the page gate is maintenance:update.
  const canBackup = hasEffectivePermission(effective, 'maintenance:enable');
  const canTestAlert = hasEffectivePermission(effective, 'monitor:test');
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [discordState, setDiscordState] = useState<string>('');
  const [discordError, setDiscordError] = useState('');
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordTesting, setDiscordTesting] = useState(false);

  const loadDiscordSettings = async (): Promise<void> => {
    const result = await getDiscordNotificationSettings();
    if (!result.success) {
      setDiscordError(result.error);
      return;
    }
    setDiscordState(describeDiscordState(result));
  };

  useEffect(() => {
    void (async () => {
      const result = await readConfigTomlValues(MAINTENANCE_CONFIG_KEYS);
      if (result.success) {
        setData(result.values);
      }
      await loadDiscordSettings();
      setLoading(false);
    })();
  }, []);

  const handleChange = (key: string, val: string) => {
    setData(prev => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const backupResult = await updateConfigTomlValues(buildConfigTomlUpdates(data, BACKUP_POLICY_KEYS));
      if (!backupResult.success) {
        toast.error(interpolate(toasts.saveFailed, { error: backupResult.error }));
        return;
      }
      // The webhook goes through its own action: unlike a backup policy it is validated,
      // because a malformed URL silently drops every monitor alert.
      const notificationResult = await saveDiscordNotificationSettings({
        webhookUrl: data.DISCORD_WEBHOOK_URL ?? '',
        roleId: data.DISCORD_ROLE_ID ?? '',
      }, locale);
      if (!notificationResult.success) {
        toast.error(interpolate(toasts.notificationSaveFailed, { error: notificationResult.error }));
        return;
      }
      toast.success(toasts.saved);
    } finally {
      setSaving(false);
    }
  };

  const handleBackup = async () => {
    if (!(await confirm(manualBackupConfirm()))) return;
    setBackingUp(true);
    const result = await triggerManualBackup();
    if (result.success) {
      toast.success(toasts.backupTriggered);
    } else {
      toast.error(interpolate(toasts.failed, { error: result.error }));
    }
    setBackingUp(false);
  };

  const persistDiscordSettings = async (applyToMonitor: boolean): Promise<void> => {
    setDiscordSaving(true);
    try {
      const result = await saveDiscordNotificationSettings({
        webhookUrl: data.DISCORD_WEBHOOK_URL ?? '',
        roleId: data.DISCORD_ROLE_ID ?? '',
      }, locale);
      if (!result.success) {
        setDiscordError(result.error);
        toast.error(interpolate(toasts.notificationSaveFailed, { error: result.error }));
        return;
      }
      setDiscordError('');
      await loadDiscordSettings();
      if (!applyToMonitor) {
        toast.success(toasts.notificationsSaved);
        return;
      }
      const restart = await restartServices('custom', ['monitor']);
      if (restart.success) {
        toast.success(toasts.notificationsSavedMonitorRecreated);
      } else {
        // Partial success: the settings were written, so the operator must hear both facts.
        toast.warning(interpolate(toasts.monitorRestartFailed, { error: restart.error }));
      }
    } finally {
      setDiscordSaving(false);
    }
  };

  const handleTestAlert = async (): Promise<void> => {
    setDiscordTesting(true);
    try {
      const result = await sendTestDiscordAlert({
        webhookUrl: data.DISCORD_WEBHOOK_URL ?? '',
        roleId: data.DISCORD_ROLE_ID ?? '',
      }, locale);
      if (result.success) {
        toast.success(interpolate(toasts.testAlertDelivered, { status: result.status }));
        return;
      }
      const message = result.error ?? toasts.testAlertFailedFallback;
      setDiscordError(message);
      toast.error(interpolate(toasts.testAlertFailed, { message }));
    } finally {
      setDiscordTesting(false);
    }
  };

  if (loading) return <Loading text="Loading maintenance..." fullScreen />;

  return (
    <PageContent>
      <PageHeader 
        title="Maintenance & Backups"
        description="Configure automated backups and system notifications."
        actions={
          <Button variant="positive" onClick={handleSave} loading={saving}>
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Stack gap={6}>
            <Card className="p-6 h-full">
                <Stack direction="row" align="center" gap={3} className="mb-6">
                    <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Database className="w-5 h-5 text-emerald-400" />
                    </div>
                    <Text variant="h2">Submissions Backup</Text>
                </Stack>

                <Stack gap={6}>
                    <Stack gap={4}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Backup Interval (min)"
                                type="number"
                                value={data.BACKUP_INTERVAL_MINS || ''}
                                onChange={(e) => handleChange('BACKUP_INTERVAL_MINS', e.target.value)}
                                placeholder="1440 (24h)"
                            />
                            <Input
                                label="Max Count"
                                type="number"
                                value={data.BACKUP_MAX_COUNT || ''}
                                onChange={(e) => handleChange('BACKUP_MAX_COUNT', e.target.value)}
                                placeholder="50"
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Input
                                label="Max Age (days)"
                                type="number"
                                value={data.BACKUP_MAX_AGE_DAYS || ''}
                                onChange={(e) => handleChange('BACKUP_MAX_AGE_DAYS', e.target.value)}
                                placeholder="10"
                            />
                            <Input
                                label="Storage Limit (GB)"
                                type="number"
                                value={data.BACKUP_MAX_SIZE_GB || ''}
                                onChange={(e) => handleChange('BACKUP_MAX_SIZE_GB', e.target.value)}
                                placeholder="5"
                            />
                        </div>
                    </Stack>

                    {canTriggerBackup && (
                    <Stack gap={2} className="pt-4 border-t border-border">
                        {canBackup && (
                        <Button
                            variant="positiveOutline"
                            className="w-full"
                            onClick={() => { void handleBackup(); }}
                            loading={backingUp}
                        >
                            <Zap className="w-4 h-4" />
                            Trigger Manual Backup Now
                        </Button>
                        )}
                        <Text variant="small" color="text-muted-foreground" className="text-center italic opacity-50">
                            Manual backups also respect cleanup policies.
                        </Text>
                    </Stack>
                    )}
                </Stack>
            </Card>
        </Stack>
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
                            value={data.DISCORD_WEBHOOK_URL || ''}
                            onChange={(e) => handleChange('DISCORD_WEBHOOK_URL', e.target.value)}
                            className="font-mono text-sm"
                            placeholder="https://discord.com/api/webhooks/..."
                        />
                        <Input
                            label="Mention Role ID (Optional)"
                            value={data.DISCORD_ROLE_ID || ''}
                            onChange={(e) => handleChange('DISCORD_ROLE_ID', e.target.value)}
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
                                loading={discordSaving}
                            >
                                <Save className="w-4 h-4" />
                                Save Notifications
                            </Button>
                            {canTestAlert && (
                            <Button
                                variant="secondary"
                                onClick={handleTestAlert}
                                loading={discordTesting}
                            >
                                <Send className="w-4 h-4" />
                                Send Test Alert
                            </Button>
                            )}
                            <Button
                                variant="positive"
                                onClick={() => void persistDiscordSettings(true)}
                                loading={discordSaving}
                            >
                                <RefreshCw className="w-4 h-4" />
                                Save & Restart Monitor
                            </Button>
                        </Stack>
                        {discordError && (
                            <Text variant="small" color="text-destructive">{discordError}</Text>
                        )}
                        {!discordError && discordState && (
                            <Text variant="small" color="text-muted-foreground">{discordState}</Text>
                        )}
                        <Text variant="small" color="text-muted-foreground" className="italic opacity-50">
                            The test alert uses the URL in the field above, so you can verify before saving.
                        </Text>
                    </Stack>

                    <Stack gap={2} className="p-4 bg-muted/50 rounded-xl border border-border">
                        <Stack direction="row" align="center" gap={2} className="mb-2">
                            <Shield className="w-4 h-4 text-indigo-400" />
                            <Text variant="h4">Active Monitoring</Text>
                        </Stack>
                        <ul className="text-xs text-muted-foreground space-y-2">
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-indigo-500" />
                                Container Status (Start, Stop, Die, Restart)
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-indigo-500" />
                                Resource Alerts (CPU, Memory, Disk)
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-indigo-500" />
                                Backup Results (Success/Failure)
                            </li>
                            <li className="flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-indigo-500" />
                                Admin Panel Actions (Switch Contest, manual restarts)
                            </li>
                        </ul>
                    </Stack>
                </Stack>
            </Card>
        </Stack>
      </div>
    </PageContent>
  );
}
