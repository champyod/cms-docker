'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { Save, RefreshCw, Loader } from 'lucide-react';

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
      { key: 'APT_MIRROR', label: 'Ubuntu Mirror', description: 'Mirror for apt updates.' },
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
  const [data, setData] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    setLoading(true);
    setError('');
    const newData: Record<string, Record<string, string>> = {};

    try {
      for (const section of CONFIG_SECTIONS) {
        const result = await readEnvFile(section.filename);
        if (result.success && result.config) {
          newData[section.filename] = result.config;
        } else {
          console.error(`Failed to load ${section.filename}:`, result.error);
        }
      }
      setData(newData);
    } catch (e) {
      setError('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (filename: string, key: string, value: string) => {
    // Optimistic update
    setData(prev => ({
      ...prev,
      [filename]: {
        ...prev[filename],
        [key]: value
      }
    }));
  };

  const persistChanges = async (filename: string) => {
    setSaving(true);
    const updates = data[filename];
    // Filter to only fields we care about if strict? No, save all in our UI state.
    
    // We only send updates for keys that exist in our definition? 
    // Actually we can just send the relevant ones.
    const relevantUpdates: Record<string, string> = {};
    const section = CONFIG_SECTIONS.find(s => s.filename === filename);
    
    if (section) {
        section.fields.forEach(f => {
            if (updates[f.key] !== undefined) {
                relevantUpdates[f.key] = updates[f.key];
            }
        });
    }

    const result = await updateEnvFile(filename, relevantUpdates);
    if (result.success) {
      alert(`Saved ${filename} successfully! You may need to restart services.`);
    } else {
      alert(`Failed to save ${filename}: ` + result.error);
    }
    setSaving(false);
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

      {CONFIG_SECTIONS.map((section) => (
        <Card key={section.title} className="glass-card border-white/5 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">{section.title}</h2>
              <p className="text-neutral-400 text-sm mt-1">Editing {section.filename}</p>
            </div>
            <button
              onClick={() => persistChanges(section.filename)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
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
                    onChange={(e) => handleSave(section.filename, field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full px-4 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <div className="flex justify-end pt-4">
        <p className="text-neutral-500 text-xs italic">
          Note: Changing IP addresses or ports may require restarting the CMS services. Use the buttons below or Docker commands.
        </p>
      </div>

      <Card className="glass-card border-white/5 p-6">
        <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Service Control</h2>
              <p className="text-neutral-400 text-sm mt-1">Restart services to apply configuration changes.</p>
            </div>
        </div>
        <div className="flex gap-4">
            <RestartButton type="core" label="Restart Core Services" />
            <RestartButton type="worker" label="Restart Worker" />
        </div>
      </Card>
    </div>
  );
}

function RestartButton({ type, label }: { type: 'core' | 'worker', label: string }) {
    const [restarting, setRestarting] = useState(false);
    
    const handleRestart = async () => {
        if (!confirm(`Are you sure you want to ${label}? This will temporarily disrupt service.`)) return;
        setRestarting(true);
        // We need to import restartServices here, but to avoid circular deps or complex passing, 
        // we can assume it's imported at top.
        // Actually, let's fix imports first.
        try {
            const { restartServices } = await import('@/app/actions/services');
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
