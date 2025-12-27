'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/core/Card';
import { Button } from '@/components/core/Button';
import { Plus, Trash2, Save, Server, Edit } from 'lucide-react';
import { getWorkers, updateWorkers } from '@/app/actions/workerConfig';
import { useToast } from '@/components/providers/ToastProvider';

export function WorkerNodesConfig() {
  const [workers, setWorkers] = useState<{ host: string; port: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editData, setEditData] = useState({ host: '', port: '' });
  const { addToast } = useToast();
  
  const [newHost, setNewHost] = useState('');
  const [newPort, setNewPort] = useState('26000');
  const [showAddForm, setShowAddForm] = useState(false);

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
    setShowAddForm(false);
  };

  const handleRemove = (index: number) => {
    const next = [...workers];
    next.splice(index, 1);
    setWorkers(next);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditData({ host: workers[index].host, port: workers[index].port.toString() });
  };

  const saveEdit = () => {
    if (editingIndex === null) return;
    const next = [...workers];
    next[editingIndex] = { host: editData.host, port: parseInt(editData.port) };
    setWorkers(next);
    setEditingIndex(null);
  };

  const handleSave = async () => {
    const res = await updateWorkers(workers);
    if (res.success) {
      addToast({
        title: 'Configuration Saved',
        message: 'Worker nodes updated in cms.toml. You need to restart services in Container Control Center to apply the changes.',
        type: 'success'
      });
    } else {
      addToast({ title: 'Failed to Save', message: res.error, type: 'error' });
    }
  };

  return (
    <Card className="glass-card border-white/5 overflow-hidden">
      <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Server className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Worker Nodes</h2>
            <p className="text-sm text-neutral-400">Configure core service connection endpoints</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => setShowAddForm(!showAddForm)}
            className="border-white/10 text-white"
          >
            <Plus className="w-4 h-4 mr-2" /> Add Node
          </Button>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20">
            <Save className="w-4 h-4 mr-2" /> Save Changes
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {showAddForm && (
          <div className="mb-6 bg-indigo-500/5 p-4 rounded-xl border border-indigo-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-4 flex items-center justify-between">
              Add New Worker Node
              <button onClick={() => setShowAddForm(false)} className="text-neutral-500 hover:text-white">✕</button>
            </div>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-[10px] uppercase text-neutral-500 font-bold mb-1.5">Hostname or IP Address</label>
                <input
                  value={newHost}
                  onChange={e => setNewHost(e.target.value)}
                  placeholder="e.g., 10.0.0.5"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
                  autoFocus
                />
              </div>
              <div className="w-32">
                <label className="block text-[10px] uppercase text-neutral-500 font-bold mb-1.5">Port</label>
                <input
                  value={newPort}
                  onChange={e => setNewPort(e.target.value)}
                  type="number"
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <Button onClick={handleAdd} size="sm" className="bg-indigo-500 hover:bg-indigo-400 text-white px-4 h-9">
                Add Node
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10 text-neutral-500 gap-3">
            <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            Loading configuration...
          </div>
        ) : (
            <div className="grid grid-cols-1 gap-3">
                {workers.map((w, i) => (
                  <div key={i} className="group flex gap-4 items-center bg-white/[0.03] p-4 rounded-xl border border-white/5 hover:border-white/10 transition-all hover:bg-white/[0.05]">
                    <div className="w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-xs font-bold text-neutral-500 group-hover:text-indigo-400 transition-colors">
                      {i + 1}
                    </div>

                    {editingIndex === i ? (
                      <div className="flex-1 flex gap-3">
                        <input
                          value={editData.host}
                          onChange={e => setEditData({ ...editData, host: e.target.value })}
                          className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
                        />
                        <input
                          value={editData.port}
                          onChange={e => setEditData({ ...editData, port: e.target.value })}
                          type="number"
                          className="w-24 bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
                        />
                        <Button size="sm" onClick={saveEdit} className="bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30">Done</Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 font-mono text-sm text-neutral-200">{w.host}</div>
                        <div className="w-24 font-mono text-sm text-indigo-400/80">{w.port}</div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(i)} className="text-neutral-400 hover:text-white">
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleRemove(i)} className="text-red-400/60 hover:text-red-400">
                            <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                      </>
                    )}
                    </div>
                ))}
                
                {workers.length === 0 && (
                <div className="text-center py-10 bg-black/20 rounded-xl border border-dashed border-white/5 text-neutral-500">
                  No worker nodes defined in configuration.
                </div>
                )}
            </div>
        )}
      </div>
    </Card>
  );
}
