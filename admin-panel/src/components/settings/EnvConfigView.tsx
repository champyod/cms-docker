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
    title: 'Contest Settings',
    filename: '.env.contest',
    fields: [
      { key: 'CONTEST_ID', label: 'Active Contest ID', description: 'Currently serving contest.' },
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
  }
];

export function EnvConfigView() {
  const [originalData, setOriginalData] = useState<Record<string, Record<string, string>>>({});
  const [data, setData] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
              console.error(`Failed to load ${section.filename}:`, result.error);
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
                // Determine restart strategy. If "core" services are involved, might be better to restart core stack.
                // But for now, let's try the custom list or fallback to safe stack restarts.
                // The restartServices action handles 'custom' list.
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
                <button
                onClick={() => persistChanges(section.filename, false)}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
                >
                <Save className="w-4 h-4" />
                Save Only
                </button>
                {requiredRestarts.length > 0 && (
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
                  <input
                    type="text"
                    value={data[section.filename]?.[field.key] || ''}
                    onChange={(e) => handleChange(section.filename, field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
                  />
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
