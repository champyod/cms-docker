'use client';

import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/core/Button';
import type { WorkerNodeAddFormState } from './useWorkerNodeAddForm';

interface AddWorkerNodeFormProps {
  form: WorkerNodeAddFormState;
}

export function AddWorkerNodeForm({ form }: AddWorkerNodeFormProps): ReactElement {
  return (
    <div className="mb-6 bg-primary/5 p-4 rounded-xl border border-primary/25 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="text-xs font-bold text-primary uppercase tracking-wider mb-4 flex items-center justify-between">
        Add New Worker Node
        <button
          onClick={() => form.setShowAddForm(false)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close add worker node form"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-xs uppercase text-muted-foreground font-bold mb-1.5">Hostname or IP Address</label>
          <input
            value={form.newHost} onChange={e => form.setNewHost(e.target.value)} autoFocus
            placeholder="e.g., cms-worker-0 or 192.168.1.50"
            className="w-full bg-background/80 border border-border rounded-lg px-4 py-2 text-foreground text-sm font-mono focus:outline-none focus:border-ring/60"
          />
          <p className="text-xs text-muted-foreground/70 mt-1 italic">Supports local container names or remote server IPs.</p>
        </div>
        <div className="w-32">
          <label className="block text-xs uppercase text-muted-foreground font-bold mb-1.5">Port</label>
          <input
            value={form.newPort}
            onChange={e => form.setNewPort(e.target.value)}
            type="number"
            className="w-full bg-background/80 border border-border rounded-lg px-4 py-2 text-foreground text-sm font-mono focus:outline-none focus:border-ring/60"
          />
        </div>
        <Button onClick={form.handleAdd} size="sm">
          Add Node
        </Button>
      </div>
    </div>
  );
}
