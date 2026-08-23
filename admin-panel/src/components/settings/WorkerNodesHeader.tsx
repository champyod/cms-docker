'use client';

import type { ReactElement } from 'react';
import { Button } from '@/components/core/Button';
import { Plus, Save, Server } from 'lucide-react';

interface WorkerNodesHeaderProps {
  onToggleAddForm: () => void;
  onSave: () => void;
}

export function WorkerNodesHeader({ onToggleAddForm, onSave }: WorkerNodesHeaderProps): ReactElement {
  return (
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
        <Button variant="secondary" onClick={onToggleAddForm} className="border-white/10 text-white">
          <Plus className="w-4 h-4 mr-2" /> Add Node
        </Button>
        <Button onClick={onSave} className="bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20">
          <Save className="w-4 h-4 mr-2" /> Save Changes
        </Button>
      </div>
    </div>
  );
}
