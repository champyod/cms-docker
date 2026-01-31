'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { readEnvFile, updateEnvFile } from '@/app/actions/env';
import { analyzeRestartRequirements, restartServices } from '@/app/actions/services';
import { Save, RefreshCw, Loader, AlertTriangle, Trash2, Plus, Globe, Hash, Rocket } from 'lucide-react';

export default function DeploymentsPage() {
  const [config, setConfig] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [requiredRestarts, setRequiredRestarts] = useState<string[]>([]);
  const [originalConfig, setOriginalConfig] = useState<string>('[]');
  const [originalGlobal, setOriginalGlobal] = useState<string>('{}');

  const loadData = async () => {
    setLoading(true);
    const result = await readEnvFile('.env.contest');
    if (result.success && result.config) {
      const deployConfig = result.config.CONTESTS_DEPLOY_CONFIG || '[]';
      setOriginalConfig(deployConfig);
      
      const globals = { ...result.config };
      delete globals.CONTESTS_DEPLOY_CONFIG;
      setGlobalSettings(globals);
      setOriginalGlobal(JSON.stringify(globals));

      try {
        setConfig(JSON.parse(deployConfig));
      } catch (e) {
        setConfig([]);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const isDirty = JSON.stringify(config) !== originalConfig || JSON.stringify(globalSettings) !== originalGlobal;

  useEffect(() => {
    if (isDirty) {
        analyzeRestartRequirements(['CONTESTS_DEPLOY_CONFIG', ...Object.keys(globalSettings)]).then(res => {
            setRequiredRestarts(res.requiredRestarts);
        });
    } else {
        setRequiredRestarts([]);
    }
  }, [config, globalSettings, isDirty]);

  const handleSave = async (shouldRestart: boolean = false) => {
    setSaving(true);
    const configStr = JSON.stringify(config);
    const updates = { 
        ...globalSettings,
        CONTESTS_DEPLOY_CONFIG: configStr 
    };
    
    const result = await updateEnvFile('.env.contest', updates);
    
    if (result.success) {
        setOriginalConfig(configStr);
        setOriginalGlobal(JSON.stringify(globalSettings));
        if (shouldRestart) {
            const restartRes = await restartServices('custom', ['contest-stack']);
            if (restartRes.success) {
                alert('Saved and restarted contest stack successfully!');
            } else {
                alert('Saved, but restart failed: ' + restartRes.error);
            }
        } else {
            alert('Saved successfully!');
        }
    } else {
        alert('Failed to save: ' + result.error);
    }
    setSaving(false);
  };

  const handleGlobalChange = (key: string, val: string) => {
    setGlobalSettings(prev => ({ ...prev, [key]: val }));
  };

  const addItem = () => {
    const nextId = config.length > 0 ? Math.max(...config.map(i => i.id)) + 1 : 1;
    const nextPort = config.length > 0 ? Math.max(...config.map(i => i.port)) + 1 : 8888;
    setConfig([...config, { id: nextId, port: nextPort, domain: `contest-${nextId}.cms.local` }]);
  };

  const removeItem = (index: number) => {
    setConfig(config.filter((_, i) => i !== index));
  };

  if (loading) return <div className="p-8 text-white flex items-center gap-2"><Loader className="animate-spin" /> Loading deployments...</div>;

  return (
    <div className="space-y-8 p-8 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Contest Infrastructure</h1>
          <p className="text-neutral-400">Manage contest instances and global security settings.</p>
        </div>
        <div className="flex gap-3">
            <button
                onClick={() => handleSave(false)}
                disabled={saving || !isDirty}
                className="flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
                <Save className="w-4 h-4" />
                Save Only
            </button>
            <button
                onClick={() => handleSave(true)}
                disabled={saving || !isDirty}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50 font-medium shadow-lg shadow-indigo-900/20"
            >
                <RefreshCw className={`w-4 h-4 ${saving ? 'animate-spin' : ''}`} />
                Save & Restart Stack
            </button>
        </div>
      </div>

      {requiredRestarts.length > 0 && (
         <div className="p-4 bg-amber-500/10 border border-amber-500/50 rounded-xl flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
                <h3 className="font-bold text-amber-500">Restart Required</h3>
                <p className="text-sm text-neutral-300">Applying these changes will recreate the entire contest container stack.</p>
            </div>
         </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-6">
            <div className="flex items-center justify-between px-2">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Rocket className="w-5 h-5 text-indigo-400" />
                    Instance Deployments
                </h2>
                <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold uppercase tracking-widest rounded border border-indigo-500/20">
                    {config.length} Active
                </span>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
                {config.map((item, index) => (
                    <div key={index} className="flex items-center gap-4 bg-white/[0.02] p-4 rounded-xl border border-white/5 group hover:border-indigo-500/30 transition-colors">
                        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Contest ID</label>
                                <div className="flex items-center gap-2 bg-black/20 px-3 py-2 rounded-lg border border-white/5">
                                    <Hash className="w-3 h-3 text-neutral-500" />
                                    <input 
                                        type="number" 
                                        value={item.id} 
                                        onChange={(e) => {
                                            const newConfig = [...config];
                                            newConfig[index] = { ...newConfig[index], id: parseInt(e.target.value) || 0 };
                                            setConfig(newConfig);
                                        }}
                                        className="bg-transparent text-sm text-white w-full outline-none"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">External Port</label>
                                <div className="flex items-center gap-2 bg-black/20 px-3 py-2 rounded-lg border border-white/5">
                                    <Globe className="w-3 h-3 text-neutral-500" />
                                    <input 
                                        type="number" 
                                        value={item.port} 
                                        onChange={(e) => {
                                            const newConfig = [...config];
                                            newConfig[index] = { ...newConfig[index], port: parseInt(e.target.value) || 0 };
                                            setConfig(newConfig);
                                        }}
                                        className="bg-transparent text-sm text-white w-full outline-none"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Domain</label>
                                <input 
                                    type="text" 
                                    value={item.domain || ''} 
                                    onChange={(e) => {
                                        const newConfig = [...config];
                                        newConfig[index] = { ...newConfig[index], domain: e.target.value };
                                        setConfig(newConfig);
                                    }}
                                    className="bg-black/20 px-3 py-2 rounded-lg border border-white/5 text-sm text-indigo-300 w-full outline-none focus:border-indigo-500/50"
                                    placeholder="e.g. contest.local"
                                />
                            </div>
                        </div>
                        <button 
                            onClick={() => removeItem(index)}
                            className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                ))}
                
                {config.length === 0 && (
                    <div className="p-12 text-center border-2 border-dashed border-white/5 rounded-2xl bg-white/[0.01]">
                        <Rocket className="w-12 h-12 text-neutral-700 mx-auto mb-4" />
                        <p className="text-neutral-500">No contest instances configured.</p>
                    </div>
                )}

                <button 
                    onClick={addItem}
                    className="flex items-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl transition-all w-full justify-center border border-white/5 mt-2 font-medium"
                >
                    <Plus className="w-4 h-4" />
                    New Contest Instance
                </button>
            </div>
        </div>

        <div className="space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 px-2">
                <Shield className="w-5 h-5 text-indigo-400" />
                Global Settings
            </h2>
            
            <Card className="glass-card border-white/5 p-6 space-y-6">
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Security Secret Key</label>
                    <input 
                        type="password" 
                        value={globalSettings.SECRET_KEY || ''} 
                        onChange={(e) => handleGlobalChange('SECRET_KEY', e.target.value)}
                        className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 font-mono text-xs"
                        placeholder="Generated automatically if empty"
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">CPU Limit</label>
                        <input 
                            type="text" 
                            value={globalSettings.CONTEST_WEB_CPU_LIMIT || ''} 
                            onChange={(e) => handleGlobalChange('CONTEST_WEB_CPU_LIMIT', e.target.value)}
                            className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                            placeholder="e.g. 2"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Mem Limit</label>
                        <input 
                            type="text" 
                            value={globalSettings.CONTEST_WEB_MEMORY_LIMIT || ''} 
                            onChange={(e) => handleGlobalChange('CONTEST_WEB_MEMORY_LIMIT', e.target.value)}
                            className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                            placeholder="e.g. 2G"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Cookie Duration (s)</label>
                    <input 
                        type="number" 
                        value={globalSettings.COOKIE_DURATION || ''} 
                        onChange={(e) => handleGlobalChange('COOKIE_DURATION', e.target.value)}
                        className="w-full bg-black/40 px-4 py-2 rounded-lg border border-white/10 text-white outline-none focus:border-indigo-500/50 text-sm"
                        placeholder="10800"
                    />
                </div>

                <div className="pt-4 border-t border-white/5">
                    <div className="flex items-center gap-2 mb-2">
                        <input 
                            type="checkbox" 
                            id="tls"
                            checked={globalSettings.ENABLE_TLS === 'true'} 
                            onChange={(e) => handleGlobalChange('ENABLE_TLS', e.target.checked ? 'true' : 'false')}
                            className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="tls" className="text-xs text-neutral-300">Enable HTTPS (Traefik)</label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            id="localCopy"
                            checked={globalSettings.SUBMIT_LOCAL_COPY === 'true'} 
                            onChange={(e) => handleGlobalChange('SUBMIT_LOCAL_COPY', e.target.checked ? 'true' : 'false')}
                            className="rounded border-white/10 bg-black/40 text-indigo-600 focus:ring-indigo-500"
                        />
                        <label htmlFor="localCopy" className="text-xs text-neutral-300">Store Local Copy of Submissions</label>
                    </div>
                </div>
            </Card>
        </div>
      </div>
    </div>
  );
}
