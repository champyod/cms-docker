'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { triggerManualBackup } from '@/app/actions/services';
import { Save, Database, Bell, Shield, Zap } from 'lucide-react';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Button } from '@/components/core/Button';
import { Input } from '@/components/core/Input';
import { Loading } from '@/components/core/Loading';

export default function MaintenanceClient() {
  const [data, setData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);

  const loadData = async () => {
    setLoading(true);
    const result = await readEnvFile('.env.infra');
    if (result.success && result.config) {
      setData(result.config);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleChange = (key: string, val: string) => {
    setData(prev => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await updateEnvFile('.env.infra', data);
    if (result.success) {
      alert('Maintenance settings saved successfully!');
    } else {
      alert('Failed to save: ' + result.error);
    }
    setSaving(false);
  };

  const handleBackup = async () => {
    if (!confirm('Trigger a manual backup of all submissions?')) return;
    setBackingUp(true);
    const result = await triggerManualBackup();
    if (result.success) {
      alert('Backup triggered in background. Check Discord for status.');
    } else {
      alert('Failed: ' + result.error);
    }
    setBackingUp(false);
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

                    <Stack gap={2} className="pt-4 border-t border-border">
                        <Button
                            variant="positiveOutline"
                            className="w-full"
                            onClick={handleBackup}
                            loading={backingUp}
                        >
                            <Zap className="w-4 h-4" />
                            Trigger Manual Backup Now
                        </Button>
                        <Text variant="small" color="text-muted-foreground" className="text-center italic opacity-50">
                            Manual backups also respect cleanup policies.
                        </Text>
                    </Stack>
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
