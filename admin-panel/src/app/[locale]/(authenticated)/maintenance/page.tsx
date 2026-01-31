'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { triggerManualBackup } from '@/app/actions/services';
import { 
  Save, RefreshCw, Loader, AlertTriangle, 
  Database, Bell, Clock, Shield, Trash2, Zap
} from 'lucide-react';

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

  if (loading) return <div className="p-8 text-white flex items-center gap-2"><Loader className="animate-spin" /> Loading maintenance...</div>;

  return (
    <div className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Maintenance & Backups</h1>
          <p className="text-neutral-400">Configure automated backups and system notifications.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 font-medium"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Backup Section */}
        <div className="space-y-6">
            <Card className="glass-card border-white/5 p-6 h-full">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-emerald-500/10 rounded-lg">
                        <Database className="w-5 h-5 text-emerald-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Submissions Backup</h2>
                </div>

                <div className="space-y-6">
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Backup Interval (min)</label>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_INTERVAL_MINS || ''} 
                                    onChange={(e) => handleChange('BACKUP_INTERVAL_MINS', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="1440 (24h)"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max Count</label>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_COUNT || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_COUNT', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="50"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Max Age (days)</label>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_AGE_DAYS || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_AGE_DAYS', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="10"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Storage Limit (GB)</label>
                                <input 
                                    type="number" 
                                    value={data.BACKUP_MAX_SIZE_GB || ''} 
                                    onChange={(e) => handleChange('BACKUP_MAX_SIZE_GB', e.target.value)}
                                    className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-emerald-500/50"
                                    placeholder="5"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-white/5">
                        <button
                            onClick={handleBackup}
                            disabled={backingUp}
                            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 rounded-xl transition-all font-medium"
                        >
                            {backingUp ? <Loader className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                            Trigger Manual Backup Now
                        </button>
                        <p className="text-[10px] text-neutral-500 mt-2 text-center italic">
                            Manual backups also respect cleanup policies.
                        </p>
                    </div>
                </div>
            </Card>
        </div>

        {/* Discord Section */}
        <div className="space-y-6">
            <Card className="glass-card border-white/5 p-6 h-full">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 bg-indigo-500/10 rounded-lg">
                        <Bell className="w-5 h-5 text-indigo-400" />
                    </div>
                    <h2 className="text-xl font-bold text-white">Discord Notifications</h2>
                </div>

                <div className="space-y-6">
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Webhook URL</label>
                            <input 
                                type="password" 
                                value={data.DISCORD_WEBHOOK_URL || ''} 
                                onChange={(e) => handleChange('DISCORD_WEBHOOK_URL', e.target.value)}
                                className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-sm"
                                placeholder="https://discord.com/api/webhooks/..."
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-neutral-500 uppercase tracking-widest">Mention User ID (Optional)</label>
                            <input 
                                type="text" 
                                value={data.DISCORD_USER_ID || ''} 
                                onChange={(e) => handleChange('DISCORD_USER_ID', e.target.value)}
                                className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-sm"
                                placeholder="1234567890..."
                            />
                        </div>
                    </div>

                    <div className="p-4 bg-black/20 rounded-xl border border-white/5">
                        <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                            <Shield className="w-4 h-4 text-indigo-400" />
                            Active Monitoring
                        </h3>
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
                    </div>
                </div>
            </Card>
        </div>
      </div>
    </div>
  );
}
