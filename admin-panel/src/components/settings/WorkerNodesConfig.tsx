'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Plus, Trash2, Save, Server } from 'lucide-react';
import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { useToast } from '@/components/providers/ToastProvider';

export function WorkerNodesConfig() {
  const [workers, setWorkers] = useState<{ host: string; port: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();
  
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('26000');

  useEffect(() => {
    loadWorkers();
  }, []);

  const loadWorkers = async () => {
    setLoading(true);
    const data = await getWorkers();
    setWorkers(data);
    setLoading(false);
  };

  const handleAdd = () => {
    if (!newHost || !newPort) return;
    setWorkers([...workers, { host: newHost, port: parseInt(newPort) }]);
    setNewHost('');
    setNewPort('26000');
  };

  const handleRemove = (index: number) => {
    const next = [...workers];
    next.splice(index, 1);
    setWorkers(next);
  };

  const handleSave = async () => {
    const res = await updateWorkers(workers);
    if (res.success) {
        addToast({ title: 'Worker configuration saved', type: 'success' });
    } else {
        addToast({ title: 'Failed to save', message: res.error, type: 'error' });
    }
  };

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-indigo-400" />
            Worker Nodes (cms.toml)
          </h2>
          <p className="text-sm text-neutral-400">
            Define worker nodes that the core service should connect to.
          </p>
        </div>
        <Button onClick={handleSave} className="bg-emerald-600 hover:bg-emerald-500 text-white">
          <Save className="w-4 h-4 mr-2" /> Save Config
        </Button>
      </div>

      <div className="space-y-4">
        {loading ? (
             <div className="text-neutral-400 italic">Loading configuration...</div>
        ) : (
            <div className="space-y-4">
                {workers.map((w, i) => (
                    <div key={i} className="flex gap-4 items-center bg-black/30 p-3 rounded-lg border border-white/5">
                        <div className="flex-1 text-white font-mono">{w.host}</div>
                        <div className="w-32 text-indigo-400 font-mono">{w.port}</div>
                        <Button variant="ghost" size="sm" onClick={() => handleRemove(i)} className="text-red-400 hover:text-red-300">
                            <Trash2 className="w-4 h-4" />
                        </Button>
                    </div>
                ))}
                
                {workers.length === 0 && (
                    <div className="text-neutral-500 text-sm">No workers configured in cms.toml</div>
                )}
            </div>
        )}

        <div className="flex gap-4 items-end bg-white/5 p-4 rounded-lg">
           <div className="flex-1">
             <label className="block text-xs uppercase text-neutral-500 font-bold mb-1">Host / IP</label>
             <input 
               value={newHost}
               onChange={e => setNewHost(e.target.value)}
               placeholder="192.168.x.x or hostname"
               className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-white text-sm font-mono"
             />
           </div>
           <div className="w-32">
             <label className="block text-xs uppercase text-neutral-500 font-bold mb-1">Port</label>
             <input 
               value={newPort}
               onChange={e => setNewPort(e.target.value)}
               type="number"
               className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-white text-sm font-mono"
             />
           </div>
           <Button onClick={handleAdd} className="bg-indigo-600 hover:bg-indigo-500 text-white mb-[1px]">
             <Plus className="w-4 h-4 mr-2" /> Add Node
           </Button>
        </div>
      </div>
    </Card>
  );
}
