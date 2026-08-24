'use client';

import type { ReactElement } from 'react';
import { Button } from '@/components/core/Button';
import { RefreshCw, Edit, Trash2 } from 'lucide-react';
import type { WorkerEditDraft, WorkerEndpoint, WorkerStatus } from './workerNodesTypes';
import type { WorkerNodeRowEditor } from './useWorkerNodeRowEditor';
import { getStatusIcon, getStatusColor } from './workerNodeStatus';

interface WorkerDisplayInfoProps {
  worker: WorkerEndpoint;
  status?: WorkerStatus;
}

function WorkerDisplayInfo({ worker, status }: WorkerDisplayInfoProps): ReactElement {
  return (
    <div className="flex-1">
      <div className="font-mono text-sm text-foreground">{worker.host}:{worker.port}</div>
      <div className="flex items-center gap-2 mt-1">
        {status && (
          <>
            {getStatusIcon(status.status)}
            <span className={`text-xs px-2 py-0.5 rounded border ${getStatusColor(status.status)}`}>
              {status.status.toUpperCase()}
            </span>
            {!status.containerRunning && status.status !== 'connected' && (
              <span className="text-[10px] text-muted-foreground">(container offline)</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface WorkerEditFieldsProps {
  editData: WorkerEditDraft;
  setEditData: (draft: WorkerEditDraft) => void;
  onSave: () => void;
}

function WorkerEditFields({ editData, setEditData, onSave }: WorkerEditFieldsProps): ReactElement {
  return (
    <div className="flex-1 flex gap-3">
      <input
        value={editData.host}
        onChange={e => setEditData({ ...editData, host: e.target.value })}
        className="flex-1 bg-background/80 border border-border rounded-lg px-3 py-1.5 text-foreground text-sm font-mono focus:outline-none focus:border-ring/60"
      />
      <input
        value={editData.port}
        onChange={e => setEditData({ ...editData, port: e.target.value })}
        type="number"
        className="w-24 bg-background/80 border border-border rounded-lg px-3 py-1.5 text-foreground text-sm font-mono focus:outline-none focus:border-ring/60"
      />
      <Button size="sm" onClick={onSave}>Done</Button>
    </div>
  );
}

interface WorkerRowActionsProps {
  canRetry: boolean;
  onRetry: () => void;
  onStartEdit: () => void;
  onRemove: () => void;
}

function WorkerRowActions({ canRetry, onRetry, onStartEdit, onRemove }: WorkerRowActionsProps): ReactElement {
  return (
    <div className="flex items-center gap-1">
      {canRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry} className="text-info hover:text-info/80 opacity-100">
          <RefreshCw className="w-4 h-4" />
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onStartEdit} className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
        <Edit className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={onRemove} className="text-destructive/70 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity">
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

interface WorkerNodeRowProps {
  index: number;
  worker: WorkerEndpoint;
  status?: WorkerStatus;
  editing: boolean;
  editor: WorkerNodeRowEditor;
  onRetry: () => void;
  onRemove: () => void;
}

export function WorkerNodeRow({ index, worker, status, editing, editor, onRetry, onRemove }: WorkerNodeRowProps): ReactElement {
  return (
    <div
      data-shortcut-row=""
      className="group bg-muted/30 p-4 rounded-xl border border-border hover:border-ring/40 hover:bg-muted/50 transition-all"
    >
      <div className="flex gap-4 items-center">
        <div className="w-8 h-8 rounded-lg bg-background/60 flex items-center justify-center text-xs font-bold text-muted-foreground group-hover:text-primary transition-colors">
          {index + 1}
        </div>

        {editing ? (
          <WorkerEditFields editData={editor.editData} setEditData={editor.setEditData} onSave={editor.saveEdit} />
        ) : (
          <>
            <WorkerDisplayInfo worker={worker} status={status} />
            <WorkerRowActions
              canRetry={status?.status === 'disconnected'}
              onRetry={onRetry}
              onStartEdit={() => editor.startEdit(index)}
              onRemove={onRemove}
            />
          </>
        )}
      </div>
    </div>
  );
}
