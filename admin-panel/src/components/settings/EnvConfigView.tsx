'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { analyzeRestartRequirements, restartServices } from '@/app/actions/services';
import { Save, RefreshCw, Loader, AlertTriangle } from 'lucide-react';

interface ConfigField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
}

interface ConfigSection {
  title: string;
  filename: string;
  fields: ConfigField[];
}

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    title: 'Database Configuration',
    filename: '.env.core',
    fields: [
      { key: 'POSTGRES_DB', label: 'Database Name', description: 'PostgreSQL database name.' },
      { key: 'POSTGRES_USER', label: 'Database User', description: 'PostgreSQL username.' },
      { key: 'POSTGRES_PASSWORD', label: 'Database Password', description: 'PostgreSQL password.' },
    ]
  },
  {
    title: 'Network & Access',
    filename: '.env.core',
    fields: [
      { key: 'PUBLIC_IP', label: 'Public IP', description: 'Public facing IP address of this server.' },
      { key: 'TAILSCALE_IP', label: 'Tailscale IP', description: 'Internal VPN IP (optional).' },
      { key: 'APT_MIRROR', label: 'Ubuntu Mirror', description: 'Mirror for apt updates.' },
    ]
  },
  {
    title: 'Admin Panel Config',
    filename: '.env.admin',
    fields: [
      { key: 'VITE_API_URL', label: 'API URL', description: 'URL for the Admin API.' },
      { key: 'ADMIN_LISTEN_PORT', label: 'Admin Port', description: 'Internal port for Admin Web Server.' },
    ]
  },
  {
    title: 'Contest Deployment (Multi)',
    filename: '.env.contest',
    fields: [
      { key: 'CONTESTS_DEPLOY_CONFIG', label: 'Multi-Contest Config', description: 'JSON configuration for multiple contest instances.' },
      { key: 'ACCESS_METHOD', label: 'Access Method', description: 'public_port or domain.' },
      { key: 'SECRET_KEY', label: 'Secret Key', description: 'Used for session signing.' },
      { key: 'COOKIE_DURATION', label: 'Cookie Duration', description: 'Session length in seconds.' },
    ]
  },
  {
    title: 'Ranking Settings',
    filename: '.env.admin',
    fields: [
      { key: 'RANKING_USERNAME', label: 'Ranking Username', description: 'Auth for scoreboard.' },
      { key: 'RANKING_PASSWORD', label: 'Ranking Password', description: 'Auth for scoreboard.' },
      { key: 'ADMIN_COOKIE_DURATION', label: 'Admin Session', description: 'Admin panel session length.' },
    ]
  },
  {
    title: 'Infrastructure & Backups',
    filename: '.env.infra',
    fields: [
      { key: 'DISCORD_WEBHOOK_URL', label: 'Discord Webhook', description: 'URL for system alerts and logs.' },
      { key: 'DISCORD_USER_ID', label: 'Discord User ID', description: 'User to mention in alerts (optional).' },
      { key: 'BACKUP_INTERVAL_MINS', label: 'Backup Interval (min)', description: '0 to disable auto-backup.' },
      { key: 'BACKUP_MAX_COUNT', label: 'Max Backup Count', description: 'Number of old backups to keep.' },
      { key: 'BACKUP_MAX_AGE_DAYS', label: 'Max Backup Age (days)', description: 'Delete backups older than X days.' },
      { key: 'BACKUP_MAX_SIZE_GB', label: 'Max Storage (GB)', description: 'Limit total backup directory size.' },
    ]
  }
];

export function EnvConfigView() {
  const [originalData, setOriginalData] = useState<Record<string, Record<string, string>>>({});
  const [data, setData] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState('');
  const [requiredRestarts, setRequiredRestarts] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const loadData = async () => {
    setLoading(true);
    setError('');
    const newData: Record<string, Record<string, string>> = {};

    try {
      for (const section of CONFIG_SECTIONS) {
        if (!newData[section.filename]) { // Avoid re-reading if already read for another section
            const result = await readEnvFile(section.filename);
            if (result.success && result.config) {
              newData[section.filename] = result.config;
            } else {
              newData[section.filename] = {};
            }
        }
      }
      setData(newData);
      setOriginalData(JSON.parse(JSON.stringify(newData))); // Deep copy
    } catch (e) {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Check for changes and analyze restart requirements
  useEffect(() => {
    const checkChanges = async () => {
        setIsAnalyzing(true);
        const changedKeys: string[] = [];
        
        Object.keys(data).forEach(filename => {
            const currentFile = data[filename] || {};
            const originalFile = originalData[filename] || {};
            
            // Check for keys in current definition
            CONFIG_SECTIONS.filter(s => s.filename === filename).forEach(section => {
                section.fields.forEach(field => {
                    if (currentFile[field.key] !== originalFile[field.key]) {
                        changedKeys.push(field.key);
                    }
                });
            });
        });

        if (changedKeys.length > 0) {
            try {
                const result = await analyzeRestartRequirements(changedKeys);
                setRequiredRestarts(result.requiredRestarts);
            } catch (e) {
                console.error("Failed to analyze restarts", e);
            }
        } else {
            setRequiredRestarts([]);
        }
        setIsAnalyzing(false);
    };

    const debounce = setTimeout(checkChanges, 500);
    return () => clearTimeout(debounce);
  }, [data, originalData]);

  const handleChange = (filename: string, key: string, value: string) => {
    setData(prev => ({
      ...prev,
      [filename]: {
        ...prev[filename],
        [key]: value
      }
    }));
  };

  const persistChanges = async (filename: string, shouldRestart: boolean = false) => {
    setSaving(true);
    try {
        const updates = data[filename];
        const relevantUpdates: Record<string, string> = {};
        
        // Find all sections that map to this filename to get all fields
        const sections = CONFIG_SECTIONS.filter(s => s.filename === filename);
        sections.forEach(section => {
             section.fields.forEach(f => {
                if (updates[f.key] !== undefined) {
                    relevantUpdates[f.key] = updates[f.key];
                }
            });
        });

        const result = await updateEnvFile(filename, relevantUpdates);
        
        if (result.success) {
            // Update original data to match new saved data
            setOriginalData(prev => ({
                ...prev,
                [filename]: { ...prev[filename], ...relevantUpdates }
            }));
            
            if (shouldRestart && requiredRestarts.length > 0) {
                const restartRes = await restartServices('custom', requiredRestarts);
                if (restartRes.success) {
                    alert(`Saved and restarted: ${requiredRestarts.join(', ')}`);
                    setRequiredRestarts([]);
                } else {
                    alert('Saved, but failed to restart: ' + restartRes.error);
                }
            } else {
                alert(`Saved ${filename} successfully!`);
            }
        } else {
            alert(`Failed to save ${filename}: ` + result.error);
        }
    } catch (e) {
        alert('An error occurred while saving.');
    } finally {
        setSaving(false);
    }
  };

  const handleManualBackup = async () => {
    if (!confirm('Start a manual backup of all submissions? This will also log to Discord.')) return;
    setBackingUp(true);
    try {
        const { triggerManualBackup } = await import('@/app/actions/services');
        const res = await triggerManualBackup();
        if (res.success) alert('Backup triggered successfully! Check logs/Discord for progress.');
        else alert('Error: ' + res.error);
    } catch (e) {
        alert('Failed to trigger backup');
    }
    setBackingUp(false);
  };

  if (loading) {
    return <div className="text-white flex items-center gap-2"><Loader className="animate-spin" /> Loading configuration...</div>;
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="p-4 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg">
          {error}
        </div>
      )}

      {requiredRestarts.length > 0 && (
         <div className="sticky top-4 z-50 p-4 bg-amber-500/10 backdrop-blur-md border border-amber-500/50 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                    <h3 className="font-bold text-amber-500">Unsaved Changes Require Restart</h3>
                    <p className="text-sm text-neutral-300 mt-1">
                        Applying these changes will automatically restart the following services:
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {requiredRestarts.map(s => (
                            <span key={s} className="px-2 py-1 bg-amber-500/20 text-amber-300 text-xs rounded border border-amber-500/20">
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
         </div>
      )}

      {CONFIG_SECTIONS.map((section) => (
        <Card key={section.title} className="glass-card border-white/5 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">{section.title}</h2>
              <p className="text-neutral-400 text-sm mt-1">Editing {section.filename}</p>
            </div>
            <div className="flex gap-2">
                {section.title === 'Infrastructure & Backups' && (
                    <button
                        onClick={handleManualBackup}
                        disabled={backingUp}
                        className="flex items-center gap-2 px-4 py-2 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 rounded-lg transition-colors disabled:opacity-50 text-sm"
                    >
                        <Save className="w-4 h-4" />
                        {backingUp ? 'Backing up...' : 'Trigger Manual Backup'}
                    </button>
                )}
                <button
                onClick={() => persistChanges(section.filename, false)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
                >
                <Save className="w-4 h-4" />
                Save Only
                </button>
                {requiredRestarts.length > 0 && requiredRestarts.some(r => section.fields.some(f => {
                    return true; // Simplified for UX
                })) && (
                    <button
                    onClick={() => persistChanges(section.filename, true)}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium shadow-lg shadow-indigo-900/20"
                    >
                    <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                    Save & Restart
                    </button>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {section.fields.map((field) => (
              <div key={field.key} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start border-b border-white/5 pb-4 last:border-0">
                <div>
                  <label className="block text-sm font-medium text-white">{field.label}</label>
                  <code className="text-xs text-indigo-400 mt-1 block">{field.key}</code>
                  {field.description && (
                     <p className="text-xs text-neutral-500 mt-1">{field.description}</p>
                  )}
                </div>
                <div className="md:col-span-2">
                  {field.key === 'CONTESTS_DEPLOY_CONFIG' ? (
                    <ContestDeploymentManager 
                        value={data[section.filename]?.[field.key] || '[]'}
                        onChange={(val) => handleChange(section.filename, field.key, val)}
                    />
                  ) : (
                    <input
                        type="text"
                        value={data[section.filename]?.[field.key] || ''}
                        onChange={(e) => handleChange(section.filename, field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card className="glass-card border-white/5 p-6">
        <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Manual Service Control</h2>
              <p className="text-neutral-400 text-sm mt-1">Force restart services if needed.</p>
            </div>
        </div>
        <div className="flex gap-4">
            <RestartButton type="core" label="Restart Core Stack" />
            <RestartButton type="worker" label="Restart Worker Stack" />
            <RestartButton type="all" label="Restart All Services" />
        </div>
      </Card>
    </div>
  );
}

import { Trash2, Plus, Globe, Hash } from 'lucide-react';

function ContestDeploymentManager({ value, onChange }: { value: string, onChange: (val: string) => void }) {
    let items: any[] = [];
    try {
        items = JSON.parse(value);
    } catch (e) {
        items = [];
    }

    const addItem = () => {
        const nextId = items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
        const nextPort = items.length > 0 ? Math.max(...items.map(i => i.port)) + 1 : 8888;
        const newItems = [...items, { id: nextId, port: nextPort, domain: `contest-${nextId}.cms.local` }];
        onChange(JSON.stringify(newItems));
    };

    const updateItem = (index: number, key: string, val: any) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [key]: val };
        onChange(JSON.stringify(newItems));
    };

    const removeItem = (index: number) => {
        const newItems = items.filter((_, i) => i !== index);
        onChange(JSON.stringify(newItems));
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2">
                {items.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 bg-black/20 p-2 rounded-lg border border-white/5 group">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                            <div className="flex items-center gap-2">
                                <Hash className="w-3 h-3 text-neutral-500" />
                                <input 
                                    type="number" 
                                    value={item.id} 
                                    onChange={(e) => updateItem(index, 'id', parseInt(e.target.value) || 0)}
                                    className="bg-transparent text-xs text-white w-full outline-none border-b border-transparent focus:border-indigo-500"
                                    placeholder="ID"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-neutral-500 font-mono">:</span>
                                <input 
                                    type="number" 
                                    value={item.port} 
                                    onChange={(e) => updateItem(index, 'port', parseInt(e.target.value) || 0)}
                                    className="bg-transparent text-xs text-white w-full outline-none border-b border-transparent focus:border-indigo-500"
                                    placeholder="Port"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Globe className="w-3 h-3 text-neutral-500" />
                                <input 
                                    type="text" 
                                    value={item.domain || ''} 
                                    onChange={(e) => updateItem(index, 'domain', e.target.value)}
                                    className="bg-transparent text-[10px] text-indigo-300 w-full outline-none border-b border-transparent focus:border-indigo-500"
                                    placeholder="Domain"
                                />
                            </div>
                        </div>
                        <button 
                            onClick={() => removeItem(index)}
                            className="p-1.5 text-neutral-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                ))}
            </div>
            <button 
                onClick={addItem}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg text-xs hover:bg-indigo-500/20 transition-all"
            >
                <Plus className="w-3 h-3" />
                Add Contest Instance
            </button>
        </div>
    );
}

function RestartButton({ type, label }: { type: 'core' | 'worker' | 'all', label: string }) {
    const [restarting, setRestarting] = useState(false);
    
    const handleRestart = async () => {
        if (!confirm(`Are you sure you want to ${label}? This will temporarily disrupt service.`)) return;
        setRestarting(true);
        try {
            const res = await restartServices(type);
            if (res.success) alert(res.message);
            else alert('Error: ' + res.error);
        } catch (e) {
            alert('Failed to restart');
        }
        setRestarting(false);
    };

    return (
        <button 
            onClick={handleRestart}
            disabled={restarting}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600/20 text-amber-400 border border-amber-500/30 rounded-lg hover:bg-amber-600/30 transition-colors disabled:opacity-50"
        >
            <RefreshCw className={`w-4 h-4 ${restarting ? 'animate-spin' : ''}`} />
            {restarting ? 'Restarting...' : label}
        </button>
    );
}
