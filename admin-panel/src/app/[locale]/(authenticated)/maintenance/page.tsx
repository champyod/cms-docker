'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { triggerManualBackup } from '@/app/actions/services';
import { 
  Save, RefreshCw, Loader, AlertTriangle, 
  Database, Bell, Clock, Shield, Trash2, Zap
} from 'lucide-react';
import { PageContent, PageHeader, Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';
import { Loading } from '@/components/core/Loading';

export default function MaintenancePage() {
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
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 font-medium shadow-lg shadow-indigo-900/20"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Backup Section */}
        <Stack gap={6}>
            <Card className="glass-card border-white/5 p-6 h-full">
                <Stack direction="row" align="center" gap={3} className="mb-6">
                    <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Database className="w-5 h-5 text-emerald-400" />
                    </div>
                    <Text variant="h2">Submissions Backup</Text>
                </Stack>

                <Stack gap={6}>
                    <Stack gap={4}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Stack gap={1}>
                                <Text variant="label">Backup Interval (min)</Text>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_INTERVAL_MINS || ''} 
                                    onChange={(e) => handleChange('BACKUP_INTERVAL_MINS', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="1440 (24h)"
                                />
                            </Stack>
                            <Stack gap={1}>
                                <Text variant="label">Max Count</Text>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_COUNT || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_COUNT', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="50"
                                />
                            </Stack>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Stack gap={1}>
                                <Text variant="label">Max Age (days)</Text>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_AGE_DAYS || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_AGE_DAYS', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="10"
                                />
                            </Stack>
                            <Stack gap={1}>
                                <Text variant="label">Storage Limit (GB)</Text>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_SIZE_GB || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_SIZE_GB', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="5"
                                />
                            </Stack>
                        </div>
                    </Stack>

                    <Stack gap={2} className="pt-4 border-t border-white/5">
                        <button
                            onClick={handleBackup}
                            disabled={backingUp}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 rounded-xl transition-all font-medium"
                        >
                            {backingUp ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            Trigger Manual Backup Now
                        </button>
                        <Text variant="small" color="text-neutral-500" className="text-center italic opacity-50">
                            Manual backups also respect cleanup policies.
                        </Text>
                    </Stack>
                </Stack>
            </Card>
        </Stack>

        {/* Discord Section */}
        <Stack gap={6}>
            <Card className="glass-card border-white/5 p-6 h-full">
                <Stack direction="row" align="center" gap={3} className="mb-6">
                    <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <Bell className="w-5 h-5 text-indigo-400" />
                    </div>
                    <Text variant="h2">Discord Notifications</Text>
                </Stack>

                <Stack gap={6}>
                    <Stack gap={4}>
                        <Stack gap={1}>
                            <Text variant="label">Webhook URL</Text>
                            <input 
                                type="password" 
                                value={data.DISCORD_WEBHOOK_URL || ''} 
                                onChange={(e) => handleChange('DISCORD_WEBHOOK_URL', e.target.value)}
                                className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-sm"
                                placeholder="https://discord.com/api/webhooks/..."
                            />
                        </Stack>
                        <Stack gap={1}>
                            <Text variant="label">Mention Role ID (Optional)</Text>
                            <input 
                                type="text" 
                                value={data.DISCORD_ROLE_ID || ''} 
                                onChange={(e) => handleChange('DISCORD_ROLE_ID', e.target.value)}
                                className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-sm"
                                placeholder="Role ID to tag in alerts"
                            />
                        </Stack>
                    </Stack>

                    <Stack gap={2} className="p-4 bg-black/20 rounded-xl border border-white/5">
                        <Stack direction="row" align="center" gap={2} className="mb-2">
                            <Shield className="w-4 h-4 text-indigo-400" />
                            <Text variant="h4">Active Monitoring</Text>
                        </Stack>
                        <ul className="text-xs text-neutral-400 space-y-2">
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
      </div>
    </div>
  );
}
