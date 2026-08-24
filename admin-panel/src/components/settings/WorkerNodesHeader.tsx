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
    <div className="p-6 border-b border-border flex items-center justify-between bg-muted/40">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Server className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Worker Nodes</h2>
          <p className="text-sm text-muted-foreground">Configure core service connection endpoints</p>
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" onClick={onToggleAddForm}>
          <Plus className="w-4 h-4 mr-2" /> Add Node
        </Button>
        <Button onClick={onSave}>
          <Save className="w-4 h-4 mr-2" /> Save Changes
        </Button>
      </div>
    </div>
  );
}
