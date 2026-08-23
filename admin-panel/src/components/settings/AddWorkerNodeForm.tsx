'use client';

import type { ReactElement } from 'react';
import { Button } from '@/components/core/Button';
import type { WorkerNodeAddFormState } from './useWorkerNodeAddForm';

interface AddWorkerNodeFormProps {
  form: WorkerNodeAddFormState;
}

export function AddWorkerNodeForm({ form }: AddWorkerNodeFormProps): ReactElement {
  return (
    <div className="mb-6 bg-indigo-500/5 p-4 rounded-xl border border-indigo-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-4 flex items-center justify-between">
        Add New Worker Node
        <button onClick={() => form.setShowAddForm(false)} className="text-neutral-500 hover:text-white">✕</button>
      </div>
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-[10px] uppercase text-neutral-500 font-bold mb-1.5">Hostname or IP Address</label>
          <input
            value={form.newHost} onChange={e => form.setNewHost(e.target.value)} autoFocus
            placeholder="e.g., cms-worker-0 or 192.168.1.50"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
          />
          <p className="text-[9px] text-neutral-600 mt-1 italic">Supports local container names or remote server IPs.</p>
        </div>
        <div className="w-32">
          <label className="block text-[10px] uppercase text-neutral-500 font-bold mb-1.5">Port</label>
          <input
            value={form.newPort}
            onChange={e => form.setNewPort(e.target.value)}
            type="number"
            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white text-sm font-mono focus:outline-none focus:border-indigo-500/50"
          />
        </div>
        <Button onClick={form.handleAdd} size="sm" className="bg-indigo-500 hover:bg-indigo-400 text-white px-4 h-9">
          Add Node
        </Button>
      </div>
    </div>
  );
}
